#!/usr/bin/env python3
"""CLI pipeline peraturan perpajakan.

Alur normal (sekali jalan penuh):
    python cli.py init
    python cli.py crawl-index
    python cli.py crawl-detail
    python cli.py parse
    python cli.py relations
    python cli.py verify --submit      # opsional, butuh ANTHROPIC_API_KEY
    python cli.py verify --collect BATCH_ID
    python cli.py validity
    python cli.py index
    python cli.py search "PPh 21 pesangon" --as-of 2019-06-30

Pemeliharaan harian:
    python cli.py refresh --days 14
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import (crawl, db, enrich, goldset, graph, llm, ocr,  # noqa: E402
                      relations, search, structure)
from pipeline.sources import peraturan_go_id as PGI, probe_site  # noqa: E402
from pipeline.config import DATA, DB_PATH, MODEL_CHEAP, PROVIDER  # noqa: E402


def p(*a):
    print(*a, flush=True)


# --- perintah ---------------------------------------------------------------
def cmd_init(args):
    db.init()
    p(f"basis data siap: {DB_PATH}")
    with db.session() as conn:
        p(json.dumps(ocr.preflight(conn), indent=2, ensure_ascii=False))


def cmd_crawl_index(args):
    f = crawl.Fetcher()
    with db.session() as conn:
        end = args.end if args.end is not None else crawl.last_page(f)
        p(f"halaman indeks: 0..{end} (± {(end + 1) * 5} dokumen)")
        n = crawl.crawl_index(conn, f, start=args.start, end=end,
                              refresh=args.refresh, progress=p)
        p(f"selesai: {n} baris indeks diproses")


def cmd_crawl_detail(args):
    f = crawl.Fetcher()
    with db.session() as conn:
        n = crawl.crawl_details(conn, f, limit=args.limit, refresh=args.refresh,
                                only_missing=not args.all, progress=p)
        p(f"selesai: {n} halaman detail")
        if args.lampiran:
            m = crawl.download_attachments(conn, f, limit=args.limit, progress=p)
            p(f"lampiran diunduh: {m}")


def cmd_parse(args):
    with db.session() as conn:
        n = structure.build_all(conn, limit=args.limit, progress=p)
        p(f"{n} dokumen dipecah menjadi unit pasal")


def cmd_index(args):
    with db.session() as conn:
        structure.reindex_fts(conn, progress=p)


def cmd_relations(args):
    with db.session() as conn:
        total, unresolved = relations.run_rules(conn, limit=args.limit, progress=p)
        p(f"relasi tersimpan: {total} | rujukan belum terpaut: {unresolved}")
        pending = conn.execute(
            "SELECT COUNT(*) c FROM relation WHERE confidence<? AND verified=0 "
            "AND type<>'DASAR_HUKUM'", (0.92,)).fetchone()["c"]
        p(f"menunggu verifikasi LLM: {pending}")


def cmd_verify(args):
    """Verifikasi kandidat ambigu lewat Batches API (diskon 50%)."""
    client = llm.LLM(MODEL_CHEAP)
    with db.session() as conn:
        if args.collect:
            hasil = client.collect_batch(args.collect)
            n = 0
            for cid, v in hasil.items():
                rid = int(cid.split("::")[1])
                row = conn.execute("SELECT * FROM relation WHERE id=?", (rid,)).fetchone()
                if not row:
                    continue
                c = relations.Cand(row["src_id"], row["dst_raw"], row["type"],
                                   row["evidence"], row["evidence_pasal_id"],
                                   row["scope"], row["confidence"], row["method"],
                                   row["dst_id"])
                c = relations.apply_verdict(c, v)
                conn.execute(
                    "UPDATE relation SET type=?,scope=?,confidence=?,method=?,"
                    "verified=1,conflict=? WHERE id=?",
                    (c.type, c.scope, c.confidence, c.method, c.note[:400], rid))
                n += 1
            conn.commit()
            p(f"{n} relasi diperbarui dari batch {args.collect}")
            return

        rows = conn.execute(
            """SELECT r.*, s.canonical src_can, s.judul src_judul,
                      d.canonical dst_can, d.judul dst_judul
                 FROM relation r
                 LEFT JOIN regulation s ON s.id=r.src_id
                 LEFT JOIN regulation d ON d.id=r.dst_id
                WHERE r.verified=0 AND r.type<>'DASAR_HUKUM' AND r.confidence<?
                ORDER BY r.confidence DESC LIMIT ?""",
            (0.92, args.limit or 5000)).fetchall()
        if not rows:
            p("tidak ada kandidat yang perlu diverifikasi")
            return

        jobs = []
        for row in rows:
            c = relations.Cand(row["src_id"], row["dst_raw"], row["type"],
                               row["evidence"], row["evidence_pasal_id"],
                               row["scope"], row["confidence"])
            c.note = row["conflict"] or ""
            src = f'{row["src_can"] or row["src_id"]} — {(row["src_judul"] or "")[:160]}'
            dst = f'{row["dst_can"] or row["dst_raw"]} — {(row["dst_judul"] or "")[:160]}'
            jobs.append(llm.Job(custom_id=f"rel::{row['id']}",
                                system_stable=relations.VERIFY_SYSTEM,
                                user=relations.verify_prompt(c, src, dst),
                                schema=relations.VERIFY_SCHEMA, max_tokens=600))

        est = llm.estimate_usd(MODEL_CHEAP, in_tok=len(jobs) * 900,
                               out_tok=len(jobs) * 160, batch=True,
                               cached_in_tok=len(jobs) * 520)
        p(f"{len(jobs)} kandidat — perkiraan biaya batch: ${est:.2f}")
        if not args.submit:
            p("jalankan ulang dengan --submit untuk mengirim ke Batches API")
            p("contoh isi permintaan pertama:\n" + jobs[0].user[:600])
            return
        bid = client.submit_batch(jobs)
        p(f"batch terkirim: {bid}")
        p(f"pantau lalu ambil hasil: python cli.py verify --collect {bid}")


def cmd_validity(args):
    with db.session() as conn:
        graph.compute_validity(conn, min_conf=args.min_conf, progress=p)
        konf = graph.antrean_tinjauan(conn, limit=args.show)
        if konf:
            p(f"\n--- {len(konf)} konflik teratas (perlu tinjauan manusia) ---")
            for r in konf[:args.show]:
                p(f"  {r['canonical']:24s} situs='{r['status_site']}' "
                  f"graf='{r['status_derived']}'")
                p(f"      {r['reason'][:160]}")


def cmd_search(args):
    with db.session() as conn:
        hasil = search.search(conn, args.query, as_of=args.as_of,
                              limit=args.limit, kategori=args.kategori,
                              jenis=args.jenis, tag=args.tag,
                              sertakan_dicabut=args.termasuk_dicabut)
        if not hasil:
            p("tidak ada hasil")
            return
        for h in hasil:
            p(f"\n[{h['skor']:>8.3f}] {h['kutipan']}")
            p(f"           status per {h['as_of']}: {h['status_pada_tanggal']}"
              f" | {h['jenis']} | {h['kategori']}")
            if h.get("lihat_juga"):
                p(f"           ↳ lihat juga: {h['lihat_juga']['canonical']}")
            p(f"           {h['cuplikan'][:240]}")
        if args.konteks:
            p("\n=== konteks siap-RAG ===")
            p(search.konteks_untuk_llm(hasil))


def cmd_daftar(args):
    """Telusuri dokumen yang badan teksnya sudah tersedia."""
    with db.session() as conn:
        w, par = ["1=1"], []
        if not args.semua:
            w.append("r.has_body=1")
        if args.jenis:
            w.append("r.jenis_code=?"); par.append(args.jenis.upper())
        if args.kategori:
            w.append("r.kategori LIKE ?"); par.append(f"{args.kategori}%")
        if args.tahun:
            w.append("r.tahun=?"); par.append(args.tahun)
        if args.tahun_min:
            w.append("r.tahun>=?"); par.append(args.tahun_min)
        if args.cari:
            w.append("(r.judul LIKE ? OR r.canonical LIKE ?)")
            par += [f"%{args.cari}%", f"%{args.cari}%"]
        if args.status:
            w.append("IFNULL(v.status_derived,'?')=?"); par.append(args.status)
        rows = conn.execute(f"""
            SELECT r.id, r.canonical, r.jenis_code, r.tahun, r.judul,
                   LENGTH(r.body_text) n_teks, r.source,
                   IFNULL(v.status_derived,'-') status,
                   (SELECT COUNT(*) FROM pasal p WHERE p.reg_id=r.id) n_pasal
              FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
             WHERE {' AND '.join(w)}
             ORDER BY r.tahun DESC, r.canonical LIMIT ?""", par + [args.limit]).fetchall()
        if not rows:
            p("tidak ada dokumen yang cocok"); return
        p(f"{'id':26s} {'nomor':22s} {'thn':>4s} {'teks':>7s} {'pasal':>5s} "
          f"{'status':10s} judul")
        for r in rows:
            p(f"{r['id'][:25]:26s} {(r['canonical'] or '')[:21]:22s} "
              f"{r['tahun'] or 0:4d} {(r['n_teks'] or 0)//1000:6d}k {r['n_pasal']:5d} "
              f"{r['status'][:9]:10s} {(r['judul'] or '')[:52]}")
        p(f"\n{len(rows)} ditampilkan. Buka satu dokumen: "
          f"python cli.py buka {rows[0]['id']}")


def cmd_buka(args):
    """Tampilkan satu dokumen: metadata, status, relasi, dan isinya."""
    with db.session() as conn:
        row = conn.execute("""
            SELECT r.*, v.status_derived, v.valid_from, v.valid_to, v.reason
              FROM regulation r LEFT JOIN validity v ON v.reg_id=r.id
             WHERE r.id=? OR UPPER(r.canonical)=UPPER(?) OR UPPER(r.nomor_raw)=UPPER(?)
             LIMIT 1""", (args.id, args.id, args.id)).fetchone()
        if not row:
            p(f"tidak ditemukan: {args.id}")
            p("cari dengan: python cli.py daftar --cari <kata>")
            return
        p(f"{'='*70}\n{row['canonical']}  —  {row['jenis']}")
        p(f"{row['judul']}\n{'='*70}")
        p(f"  tanggal   : {row['tanggal']}    kategori: {row['kategori']}")
        p(f"  status    : situs='{row['status_site']}'  graf='{row['status_derived']}'")
        p(f"  berlaku   : {row['valid_from']} s.d. {row['valid_to'] or 'sekarang'}")
        p(f"  sumber    : {row['source']}    URL: {row['url']}")
        if row["identity_ok"] == 0:
            p(f"  ! identitas menurut kop surat berbeda: {row['canonical_body']}")

        rel = conn.execute("""
            SELECT r.type, r.scope, r.confidence, r.method,
                   IFNULL(d.canonical, r.dst_raw) sasaran
              FROM relation r LEFT JOIN regulation d ON d.id=r.dst_id
             WHERE r.src_id=? AND r.type<>'DASAR_HUKUM' AND r.confidence>=0.7
             ORDER BY r.confidence DESC LIMIT 12""", (row["id"],)).fetchall()
        masuk = conn.execute("""
            SELECT r.type, r.confidence, IFNULL(s.canonical,r.src_id) sumber
              FROM relation r LEFT JOIN regulation s ON s.id=r.src_id
             WHERE r.dst_id=? AND r.type<>'DASAR_HUKUM' AND r.confidence>=0.7
             LIMIT 8""", (row["id"],)).fetchall()
        if rel:
            p("\n  peraturan ini terhadap yang lain:")
            for x in rel:
                p(f"    {x['type']:20s} {x['sasaran'][:36]:38s} "
                  f"({x['confidence']:.2f}, {x['method']})")
        if masuk:
            p("\n  yang dilakukan peraturan lain terhadapnya:")
            for x in masuk:
                p(f"    {x['sumber'][:26]:28s} -{x['type']}-> dokumen ini "
                  f"({x['confidence']:.2f})")

        pas = conn.execute(
            "SELECT path, bagian_dok, text FROM pasal WHERE reg_id=? ORDER BY seq",
            (row["id"],)).fetchall()
        if not row["body_text"]:
            p("\n  (badan teks belum tersedia untuk dokumen ini)")
            return
        if args.teks:
            p(f"\n{'-'*70}\n{row['body_text']}")
        elif pas:
            p(f"\n  {len(pas)} unit pasal:")
            for x in pas[:args.n]:
                p(f"    [{x['bagian_dok']}] {x['path']}")
                p(f"        {x['text'][:150]}")
            if len(pas) > args.n:
                p(f"    ... {len(pas)-args.n} unit lagi (--n untuk lebih banyak,"
                  f" --teks untuk teks penuh)")
        else:
            p(f"\n  {len(row['body_text'])} karakter teks "
              f"(jalankan 'cli.py parse' untuk memecah jadi pasal)")


def cmd_identitas(args):
    """Periksa ulang identitas seluruh dokumen dari kop suratnya (tanpa jaringan)."""
    from pipeline.normalize import identity_from_body
    with db.session() as conn:
        rows = conn.execute(
            "SELECT id, body_text, tahun FROM regulation WHERE body_text IS NOT NULL"
        ).fetchall()
        cocok = beda = tak_terbaca = 0
        for r in rows:
            bid = identity_from_body(r["body_text"], r["tahun"])
            ok = None if bid is None else (1 if bid.key == r["id"] else 0)
            if ok == 1:
                cocok += 1
            elif ok == 0:
                beda += 1
            else:
                tak_terbaca += 1
            conn.execute(
                "UPDATE regulation SET id_body=?, canonical_body=?, identity_ok=?"
                " WHERE id=?",
                (bid.key if bid else None, bid.canonical if bid else None,
                 ok, r["id"]))
        conn.commit()
        p(f"diperiksa {len(rows)} dokumen berbadan teks:")
        p(f"  identitas cocok      : {cocok}")
        p(f"  identitas BERBEDA    : {beda}   <- perlu tinjauan")
        p(f"  kop tak terbaca      : {tak_terbaca}")


def cmd_graph(args):
    with db.session() as conn:
        if args.chain:
            for i, node in enumerate(graph.rantai_konsolidasi(conn, args.chain)):
                p(f"  {'  ' * i}{node['canonical']} [{node['status_derived']}] "
                  f"{(node['judul'] or '')[:70]}")
            return
        if args.export:
            p(json.dumps(graph.export_graph(conn, args.export,
                                            min_conf=args.min_conf), indent=2))
            return
        p(json.dumps({
            "peraturan": conn.execute("SELECT COUNT(*) c FROM regulation").fetchone()["c"],
            "berbadan_teks": conn.execute("SELECT COUNT(*) c FROM regulation WHERE has_body=1").fetchone()["c"],
            "unit_pasal": conn.execute("SELECT COUNT(*) c FROM pasal").fetchone()["c"],
            "relasi": conn.execute("SELECT COUNT(*) c FROM relation").fetchone()["c"],
            "relasi_terpaut": conn.execute("SELECT COUNT(*) c FROM relation WHERE dst_id IS NOT NULL").fetchone()["c"],
            "konflik": conn.execute("SELECT COUNT(*) c FROM validity WHERE agrees_with_site=0").fetchone()["c"],
            "biaya_llm_usd": round(conn.execute("SELECT IFNULL(SUM(usd),0) s FROM cost_log").fetchone()["s"], 4),
        }, indent=2, ensure_ascii=False))


def cmd_ocr(args):
    with db.session() as conn:
        p(json.dumps(ocr.preflight(conn), indent=2, ensure_ascii=False))
        rows = conn.execute(
            "SELECT * FROM attachment WHERE route='pending' AND local_path IS NOT NULL"
            + (f" LIMIT {int(args.limit)}" if args.limit else "")).fetchall()
        for row in rows:
            info = ocr.route_attachment(conn, row)
            p(f"  {row['id']}: {info}")
        conn.commit()


def cmd_isi_celah(args):
    """Ambil dokumen celah dari repositori resmi, lalu masukkan ke korpus."""
    from pipeline import isi_celah

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.jalankan:
        antre = isi_celah.antrean(conn, hanya_pajak=not args.semua_kategori,
                                  jenis=args.jenis, tahun_min=args.tahun_min,
                                  batas=args.batas, lewat_ortax=args.ortax)
        sumber = (f"{len(isi_celah.SUMBER)} repositori resmi"
                  + (" lalu Ortax" if args.ortax else ""))
        print(f"{len(antre)} dokumen akan dicoba dari {sumber}…")
        print("hasil:", isi_celah.jalankan(conn, antre, jeda=args.jeda,
                                           pakai_ortax=args.ortax))

    r = isi_celah.ringkas(conn)
    print("\nper hasil:", r["per_hasil"])
    print(f'unit pasal baru: {r["unit_baru"]}')
    if r["per_sumber"]:
        print(f'\n  {"sumber":18s}{"masuk":>7s}{"unit":>8s}')
        for x in r["per_sumber"]:
            print(f'  {str(x["dari"]):18s}{x["n"]:7d}{x["unit"] or 0:8d}')
    print(f'\n  {"jenis":12s}{"dicoba":>8s}{"masuk":>7s}')
    for x in r["per_jenis"]:
        print(f'  {str(x["jenis_code"]):12s}{x["dicoba"]:8d}{x["masuk"]:7d}')
    conn.close()


def cmd_tautkan(args):
    """Tautkan relasi yang sasarannya sebenarnya ada di korpus."""
    from pipeline import tautkan

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    print("uji kering:", tautkan.periksa(conn))
    if args.terapkan:
        print("dijalankan:", tautkan.jalankan(conn))
    conn.close()


def cmd_ddtc(args):
    """Katalog dan naskah DDTC: pusat dan daerah.

    Dipisah dari `celah`/`isi-celah` yang melayani Ortax, karena identitasnya
    berbeda: peraturan daerah menuntut daerahnya masuk ke dalam kunci, dan
    memaksakannya ke jalur yang sama akan menyembunyikan pembedaan itu.
    """
    import json as _json
    from dataclasses import asdict

    from pipeline import ddtc_masuk as M
    from pipeline.sources import ddtc_koleksi as K

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    sisi = args.sisi
    sumber = f"ddtc-{sisi}"
    kanal = f"peraturan-{sisi}"
    berkas = DATA / f"ddtc_{sisi}_katalog.json"

    if args.ambil:
        s = K.sesi()
        kumpul: dict[str, dict] = {}
        potong = (K.daftar_daerah(s) if sisi == "daerah" else K.daftar_jenis(s))
        print(f"menelusuri {len(potong)} potongan katalog {sisi}…")
        for n, x in enumerate(potong, 1):
            baris, info = (K.telusuri(s, x, jeda=args.jeda) if sisi == "daerah"
                           else K.telusuri_pusat(s, x, jeda=args.jeda))
            for b in baris:
                kumpul[b.slug] = asdict(b)
            if info.get("total") and len(baris) < info["total"]:
                print(f"    kurang: {getattr(x, 'nama', x)} "
                      f"{len(baris)}/{info['total']}")
            if n % 25 == 0 or n == len(potong):
                print(f"  {n}/{len(potong)} — {len(kumpul)} dokumen")
        berkas.write_text(_json.dumps(list(kumpul.values()), ensure_ascii=False),
                          "utf-8")
        print(f"  disimpan ke {berkas}")

    if args.muat or args.ambil:
        print("pemadanan:", M.muat_katalog(conn, berkas, sumber))
        print("status   :", M.muat_status(conn, berkas, sumber))

    if args.banding:
        b = M.banding_status(conn)
        print(f"\nstatus DDTC vs hitungan kita — {b['total']} dokumen: "
              f"sepakat {b['sepakat']}, berselisih {b['berselisih']}, "
              f"DDTC bisu {b['bisu']}")
        for r in b["rinci"][:12]:
            print(f"   ddtc={r['ddtc']:<16} kita={r['kita']:<18} {r['n']}")

    antre = M.antrean(conn, sumber, batas=args.batas)
    print(f"\nantrean {sisi}: {len(antre)} dokumen belum bernaskah")
    if not args.jalankan:
        for b in antre[:10]:
            print(f"   {b['jenis_code']:<12} {b['nomor_teks']:<16} "
                  f"{b['daerah'] or '':<20} {(b['judul'] or '')[:44]}")
        print("\n(tambahkan --jalankan untuk mengambil naskahnya)")
        return
    print(M.serap(conn, antre, kanal, jeda=args.jeda))


def cmd_integrasi(args):
    """Rangkaian sesudah dokumen baru masuk, dalam urutan yang benar.

    Urutannya bukan selera. `relations` membangun ulang seluruh tabel relasi,
    dan itu **menghidupkan kembali** setiap pelanggaran hierarki yang sudah
    diselesaikan — dengan keyakinan penuh, seolah belum pernah ditinjau. Karena
    itu `tinjau` harus berjalan sesudahnya, setiap kali, dan menjalankan
    keduanya terpisah adalah cara melupakannya. Pernah 51 pelanggaran lolos
    justru karena langkah ini dijalankan sendiri-sendiri.
    """
    from pipeline import graph, relations, structure, tinjau

    with db.session() as conn:
        if not args.tanpa_urai:
            p("1/5 urai unit pasal…")
            p(f"    {structure.build_all(conn, progress=lambda m: None)} dokumen")
        p("2/5 indeks pencarian…")
        structure.reindex_fts(conn, progress=lambda m: None)
        p("3/5 relasi…")
        total, gantung = relations.run_rules(conn, progress=lambda m: None)
        p(f"    {total} relasi | {gantung} rujukan belum terpaut")

        # Membangun ulang relasi MENGHIDUPKAN KEMBALI setiap pelanggaran
        # hierarki dengan keyakinan penuh. Antrean tinjauan tidak menolongnya:
        # temuannya sudah bertanda `auto_selesai` dari putaran sebelumnya,
        # sehingga `auto_selesai()` melewatinya dan perbaikan tidak pernah
        # diterapkan ulang. Terakhir diperiksa: 429 temuan tercatat selesai,
        # 276 relasinya kembali berkeyakinan 0,97.
        #
        # Karena itu akibat mekanisnya diterapkan di sini, langsung dan
        # idempoten — bukan diserahkan kepada ingatan antrean. Antrean tetap
        # mencatatnya untuk ditinjau manusia; yang dijamin di sini hanyalah
        # bahwa relasi mustahil tidak pernah kembali dipercaya penuh.
        n = conn.execute(
            "UPDATE relation SET confidence = MIN(confidence, 0.2) "
            " WHERE conflict LIKE '%hierarki%' AND confidence > 0.2").rowcount
        conn.commit()
        p(f"    {n} pelanggaran hierarki diturunkan keyakinannya "
          f"(relasi yang mustahil menurut UU 12/2011 Pasal 7)")
        p("4/5 keberlakuan…")
        graph.compute_validity(conn, min_conf=args.min_conf,
                               progress=lambda m: None)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    p("5/5 antrean tinjauan (termasuk perbaikan hierarki yang baru hidup lagi)…")
    p(f"    bangun  : {tinjau.bangun(conn)}")
    p(f"    otomatis: {tinjau.auto_selesai(conn)}")
    r = tinjau.ringkas(conn)
    p(f"\nstatus antrean: {r['per_status']}")
    conn.close()


def cmd_unduh_pdf(args):
    """Unduh pindaian resmi untuk bentuk yang sumbernya memang menerbitkannya."""
    from pipeline import unduh_pdf

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    antre = unduh_pdf.antrean(conn, batas=args.batas, jenis=args.jenis)
    p(f"antrean: {len(antre)} dokumen berbentuk terjangkau belum punya PDF")
    p(f"bentuk terjangkau: {', '.join(unduh_pdf.BENTUK_BERPDF)}")
    p("\nTerbitan Dirjen Pajak (PER, KEP, SE, PENG, S-PJ) dan seluruh peraturan\n"
      "daerah TIDAK ada di antrean: sumber resminya tidak menerbitkan PDF untuk\n"
      "bentuk itu, dan PDF asli DDTC berada di balik langganan.")
    if not args.jalankan:
        p("\n(tambahkan --jalankan untuk mengunduh)")
        return
    p(str(unduh_pdf.jalankan(conn, antre, pekerja=args.pekerja,
                             jeda=args.jeda)))
    conn.close()


def cmd_ulang_ortax(args):
    """Ambil ulang naskah Ortax yang masih menggumpal, dengan pengurai lebih baik."""
    from pipeline import ulang_ortax

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    antre = ulang_ortax.antrean(conn, batas=args.batas)
    p(f"antrean (naskah yang masih menggumpal): {len(antre)}")
    if not args.jalankan:
        p("\n(tambahkan --jalankan untuk mengambil ulang)")
        return
    r = ulang_ortax.jalankan(conn, antre, pekerja=args.pekerja)
    p(str({k: v for k, v in r.items()}))
    if r["diganti"]:
        p(f"unit rata-rata {r['unit_sebelum'] / r['diganti']:.1f} -> "
          f"{r['unit_sesudah'] / r['diganti']:.1f}")
    conn.close()


def cmd_statistik(args):
    """Tulis seluruh statistik korpus menjadi satu berkas Excel."""
    from pipeline import statistik

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    keluar = Path(args.keluar or (DATA / "Statistik_Korpus.xlsx"))
    p("mengumpulkan…")
    D = statistik.kumpulkan(conn)
    statistik.tulis(D, keluar)
    p(f"tersimpan: {keluar}")
    p(f"  {len(D['bentuk'])} bentuk · {len(D['daerah'])} daerah · "
      f"{len(D['hierarki'])} lapis hierarki · {len(D['tinjauan'])} baris tinjauan")
    p("\nBerkasnya bertanda hitung-ulang-saat-buka, jadi sel berformula terisi "
      "begitu dibuka di Excel atau LibreOffice.")
    conn.close()


def cmd_kurang(args):
    """Apa yang masih kurang, dan mana yang menunggu keputusan manusia."""
    from pipeline import kurang, tautkan_pdf

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.tautkan_pdf:
        p("menautkan PDF yang ada di disk ke dokumennya…")
        r = tautkan_pdf.jalankan(conn, terapkan=True)
        p("  " + ", ".join(f"{k}={v}" for k, v in r.items()
                           if not k.startswith("contoh")))
    for x in kurang.laporan(conn, DATA):
        dari = f" dari {x['dari']:,}" if x["dari"] else ""
        p(f"\n{x['nama']}: {x['jumlah']:,}{dari}")
        p(f"   tindakan: {x['tindakan']}")
        if x["catatan"]:
            p(f"   catatan : {x['catatan']}")
    conn.close()


def cmd_celah(args):
    """Bandingkan korpus dengan katalog luar; laporkan yang belum ada."""
    import csv

    from pipeline import celah
    from pipeline.sources import ortax

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    berkas = DATA / "ortax_katalog.json"

    if args.ambil:
        import json as _json
        print("mengambil daftar Ortax (metadata publik)…")
        d = ortax.semua(per_page=200, jeda=args.jeda)
        berkas.write_text(_json.dumps(d, ensure_ascii=False), "utf-8")
        print(f"  {len(d)} baris disimpan ke {berkas}")
    if args.muat or args.ambil:
        print("pemadanan:", celah.muat(conn, berkas, "ortax"))

    r = celah.ringkas(conn, hanya_pajak=args.hanya_pajak)
    lingkup = "kategori pajak saja" if args.hanya_pajak else "seluruh katalog"
    print(f'\nOrtax ({lingkup}): {r["total_di_sumber"]} dokumen\n')
    print(f'BENTUK YANG KITA BAWA — celah {r["dalam_lingkup"]["celah"]}, '
          f'sudah ada {r["dalam_lingkup"]["sudah_ada"]}')
    print(f'  {"kode":14s}{"di Ortax":>10s}{"sudah":>8s}{"CELAH":>8s}')
    for x in r["dalam_lingkup"]["bentuk"]:
        if x["celah"]:
            print(f'  {x["kode"]:14s}{x["di_sumber"]:10d}{x["sudah_ada"]:8d}'
                  f'{x["celah"]:8d}')
    print(f'\nBENTUK DI LUAR LINGKUP KITA — {r["luar_lingkup"]["celah"]}')
    for x in r["luar_lingkup"]["bentuk"][:8]:
        if x["celah"]:
            print(f'  {x["kode"]:16s}{x["celah"]:7d}  {str(x["jenis"])[:44]}')

    if args.ekspor:
        d = celah.daftar(conn, jenis=args.jenis, hanya_pajak=args.hanya_pajak,
                         limit=100000)
        with open(args.ekspor, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["jenis", "nomor", "tahun", "kategori", "judul", "url"])
            for x in d["hasil"]:
                w.writerow([x["jenis_teks"], x["nomor_teks"], x["tahun"],
                            x["kategori"], x["judul"], x["url"]])
        print(f'\n{d["total"]} baris -> {args.ekspor}')
    conn.close()


def cmd_hierarki(args):
    """Peta kedudukan seluruh bentuk peraturan di korpus."""
    from pipeline import hierarki
    from pipeline.normalize import lengkapi_kode_jenis

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.lengkapi_kode:
        print("kode jenis:", lengkapi_kode_jenis(conn, terapkan=True), "\n")

    p = hierarki.peta(conn, sertakan_berkala=args.berkala)
    print(f'total: {p["total"]} dokumen'
          f'{"" if args.berkala else " (tanpa terbitan berkala)"}\n')
    for g in p["golongan"]:
        print(f'{g["nama"]}  —  {g["jumlah"]}')
        for t in g["tingkat"]:
            print(f'   {t["label"]}  ({t["jumlah"]})')
            for b in t["bentuk"]:
                st = b["status"]
                print(f'      {b["kode"]:12s}{b["jumlah"]:6d}  '
                      f'berisi={b["berteks"]:5d}  {b["tahun_awal"]}-{b["tahun_akhir"]}  '
                      f'berlaku={st.get("berlaku", 0)} dicabut={st.get("dicabut", 0)}'
                      f'  {b["nama"][:40]}')
        print()
    conn.close()


def cmd_verifikasi(args):
    """Cek status keberlakuan ke repositori peraturan lain."""
    from pipeline import verifikasi

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.jalankan:
        antre = verifikasi.antrean(conn, batas=args.batas)
        print(f"memeriksa {len(antre)} peraturan ke "
              f"{len(verifikasi.SUMBER)} repositori…")
        print("hasil pemeriksaan:", verifikasi.jalankan(conn, antre, jeda=args.jeda))
    if args.selesaikan:
        print("penutupan kasus  :", verifikasi.selesaikan(conn))

    r = verifikasi.ringkas(conn)
    print(f'\nperaturan diperiksa : {r["peraturan_diperiksa"]}')
    print(f'belum diperiksa     : {r["belum_diperiksa"]}')
    print(f'ditutup oleh sumber : {r["ditutup_oleh_sumber"]}')
    print(f'\n  {"sumber":18s}{"diperiksa":>10s}{"memuat":>8s}{"galat":>7s}')
    for x in r["per_sumber"]:
        print(f'  {x["sumber"]:18s}{x["diperiksa"]:10d}{x["memuat"]:8d}{x["galat"]:7d}')
    conn.close()


def cmd_berkala(args):
    """Urai terbitan berkala (kurs mingguan, tarif bunga bulanan)."""
    from pipeline import berkala

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.bangun:
        print("bangun:", berkala.bangun(conn))
    if args.tanggal:
        d = berkala.pada(conn, args.jenis, args.tanggal)
        if not d["terbitan"]:
            print(d["keterangan"])
        else:
            t = d["terbitan"]
            print(f'{t["canonical"]} — {t["mulai"]} s.d. {t["sampai"]}'
                  f'{"" if d["tepat"] else "  (masa berlaku sudah lewat)"}')
            if d["keterangan"]:
                print(f'  {d["keterangan"]}')
            for b in d["baris"]:
                if args.jenis == "kurs":
                    print(f'  {b["kode"]}  Rp {b["nilai"]:>13,.2f}  per '
                          f'{b["satuan"]:g}  {b["mata_uang"]}')
                else:
                    print(f'  [{b["kelompok"]:8s}] {b["persen"]:>5.2f}%  {b["dasar"]}')
    else:
        for j in ("kurs", "tarif_bunga"):
            print(f'  {j:12s} {berkala.rentang(conn, j)}')
    conn.close()


def cmd_tinjau(args):
    """Bangun antrean tinjauan, selesaikan yang berkeyakinan tinggi, atau lapor."""
    from pipeline import tinjau

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    if args.bangun:
        print("bangun  :", tinjau.bangun(conn))
    if args.auto:
        print("otomatis:", tinjau.auto_selesai(conn, ambang=args.ambang))
    if args.batalkan:
        print("batal   :", tinjau.batalkan(conn, args.batalkan))

    r = tinjau.ringkas(conn)
    print("\nper status:", r["per_status"])
    print(f'\n  {"pemeriksaan":22s}{"total":>7s}{"antre":>7s}{"otomatis":>10s}'
          f'{"manual":>8s}{"keyakinan":>11s}')
    for x in r["per_periksa"]:
        print(f'  {x["periksa"]:22s}{x["n"]:7d}{x["antre"]:7d}{x["otomatis"]:10d}'
              f'{x["manual"]:8d}{x["keyakinan_rata"]:11.2f}')
    print(f'\nperbaikan aktif (dapat dibatalkan): {r["perbaikan_aktif"]}')
    conn.close()


def cmd_sdsn(args):
    """Urai naskah konsolidasi (SDSN) dari PDF/teks, ekspor, muat ke basis data."""
    import subprocess, tempfile
    from pipeline import sdsn, structure

    berkas = Path(args.berkas)
    if berkas.suffix.lower() == ".pdf":
        txt = Path(tempfile.gettempdir()) / (berkas.stem + ".txt")
        subprocess.run(["pdftotext", "-layout", str(berkas), str(txt)], check=True)
        berkas = txt

    uu = sdsn.urai_berkas(berkas)
    keluar = Path(args.keluaran); keluar.mkdir(parents=True, exist_ok=True)
    nama = args.nama
    sdsn.ke_json(uu, keluar / f"{nama}.json")
    n_unit = sdsn.ke_jsonl(uu, keluar / f"{nama}.jsonl")
    sdsn.ke_markdown(uu, keluar / f"{nama}.md")

    print(f"{len(uu)} undang-undang, {n_unit} unit dapat dikutip")
    for u in uu:
        legenda = {**u.legenda, **u.legenda_disimpulkan}
        print(f"  {u.id:14s} {u.judul[:38]:40s} "
              f"s.d. {u.konsolidasi_sampai or '-':16s} {len(legenda)} tanda")
    print(f"  ekspor: {keluar}/{nama}.{{json,jsonl,md}}")

    if not args.tanpa_db:
        print("  db:", sdsn.muat_ke_db(uu, DB_PATH))
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        structure.reindex_fts(conn)
        conn.close()


def cmd_sources(args):
    f = crawl.Fetcher()
    with db.session() as conn:
        if args.probe:
            p(json.dumps(probe_site(f, args.probe), indent=2, ensure_ascii=False))
            return
        if args.measure:
            hasil = enrich.measure_coverage(conn, f, per_jenis=args.per_jenis,
                                            progress=p)
            p(f"\n{'jenis':10s} {'sampel':>7s} {'ketemu':>7s} {'PGI':>5s} {'JKM':>5s}"
              f" {'BPK':>5s} {'ada teks':>9s}  contoh yang tidak ketemu")
            tot_n = tot_ok = 0
            for jc, c in sorted(hasil.items(), key=lambda x: -x[1]["ketemu"]):
                tot_n += c["n"]; tot_ok += c["ketemu"]
                p(f"{jc:10s} {c['n']:7d} {c['ketemu']:7d} {c['pgi']:5d} "
                  f"{c.get('jkm',0):5d} {c['bpk']:5d} {c['ada_teks']:9d}"
                  f"  {', '.join(c['contoh_gagal'][:2])}")
            p(f"\nTOTAL sampel {tot_n}, ketemu {tot_ok} "
              f"({tot_ok * 100 // max(tot_n, 1)}%)")
            return
        if args.coverage:
            rows = enrich.coverage(conn)
            p(f"{'jenis':12s} {'total':>7s} {'tanpa teks':>11s} {'PGI':>4s} {'JKM':>4s}"
              f" {'BPK':>4s}  sumber terpilih")
            for r in rows:
                p(f"{r['jenis']:12s} {r['total']:7d} {r['tanpa_teks']:11d} "
                  f"{r['pgi']:>4s} {r['jkm']:>4s} {r['bpk']:>4s}  {r['terjangkau']}")
            terjangkau = sum(r["tanpa_teks"] for r in rows
                             if r["terjangkau"] != "TIDAK ADA SUMBER")
            total_kosong = sum(r["tanpa_teks"] for r in rows)
            yatim = [r for r in rows
                     if r["terjangkau"] == "TIDAK ADA SUMBER" and r["tanpa_teks"]]
            belum_detail = conn.execute(
                "SELECT COUNT(*) c FROM regulation WHERE body_text IS NULL"
                " AND sha256 IS NULL").fetchone()["c"]
            p(f"\ndokumen tanpa badan teks : {total_kosong}"
              + (f"  (termasuk {belum_detail} yang halaman detailnya belum diambil"
                 f" — jalankan crawl-detail dulu)" if belum_detail else ""))
            p(f"  terjangkau sumber sekunder: {terjangkau}"
              f" ({terjangkau * 100 // max(total_kosong, 1)}%)")
            p(f"  TIDAK ADA SUMBER          : {total_kosong - terjangkau}"
              f" ({(total_kosong - terjangkau) * 100 // max(total_kosong, 1)}%)")
            p("  CATATAN: kolom di atas hanya menyatakan jenis dokumen apa yang")
            p("  SECARA PRINSIP dimuat tiap situs. Untuk ketersediaan nyata")
            p("  jalankan: cli.py sources --measure")
            if yatim:
                p("  jenis tanpa sumber sekunder mana pun:")
                for r in sorted(yatim, key=lambda x: -x["tanpa_teks"])[:10]:
                    p(f"    {r['jenis']:10s} {r['tanpa_teks']:6d} dokumen")
            return
        stat = enrich.run(conn, f, hanya_tanpa_teks=not args.all,
                          limit=args.limit, ambil_teks=not args.no_pdf,
                          jenis=args.jenis, progress=p)
        p(json.dumps(stat, indent=2, ensure_ascii=False))


def cmd_goldset(args):
    with db.session() as conn:
        if args.build_silver:
            p(json.dumps(goldset.build_silver(conn, progress=p), indent=2,
                         ensure_ascii=False))
            return
        if args.sample:
            out = args.sample if args.sample != "-" else str(DATA / "goldset_review.csv")
            p(json.dumps(goldset.sample_for_review(conn, out, n=args.n, progress=p),
                         indent=2, ensure_ascii=False))
            return
        if args.import_labels:
            p(json.dumps(goldset.import_labels(conn, args.import_labels, progress=p),
                         indent=2, ensure_ascii=False))
            return
        if args.eval:
            p(json.dumps(goldset.evaluate(conn, tier=args.tier), indent=2,
                         ensure_ascii=False))
            miss = goldset.disagreements(conn)
            if miss:
                p(f"\n--- {len(miss)} relasi acuan yang TIDAK kita temukan ---")
                for m in miss[:12]:
                    p(f"  {m['src_can'] or m['src_id']:22s} -{m['type']}-> "
                      f"{m['dst_can'] or m['dst_id']}  (punya_badan_teks="
                      f"{m['has_body']})")
            return
        p(json.dumps({
            "silver": conn.execute("SELECT COUNT(*) c FROM goldset WHERE tier='silver'").fetchone()["c"],
            "gold": conn.execute("SELECT COUNT(*) c FROM goldset WHERE tier='gold'").fetchone()["c"],
        }, indent=2))


def cmd_refresh(args):
    f = crawl.Fetcher()
    with db.session() as conn:
        n = crawl.crawl_recent(conn, f, days=args.days, progress=p)
        p(f"{n} dokumen baru/berubah status")
        if n:
            crawl.crawl_details(conn, f, only_missing=True, progress=p)
            structure.build_all(conn, progress=p)
            relations.run_rules(conn, progress=p)
            graph.compute_validity(conn, progress=p)
            structure.reindex_fts(conn, progress=p)


# --- argumen ---------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init").set_defaults(fn=cmd_init)

    a = sub.add_parser("crawl-index"); a.set_defaults(fn=cmd_crawl_index)
    a.add_argument("--start", type=int, default=0)
    a.add_argument("--end", type=int, default=None)
    a.add_argument("--refresh", action="store_true")

    a = sub.add_parser("crawl-detail"); a.set_defaults(fn=cmd_crawl_detail)
    a.add_argument("--limit", type=int)
    a.add_argument("--all", action="store_true", help="ambil ulang termasuk yang sudah ada")
    a.add_argument("--refresh", action="store_true")
    a.add_argument("--lampiran", action="store_true", help="sekalian unduh PDF lampiran")

    a = sub.add_parser("parse"); a.set_defaults(fn=cmd_parse)
    a.add_argument("--limit", type=int)

    sub.add_parser("index").set_defaults(fn=cmd_index)

    a = sub.add_parser("relations"); a.set_defaults(fn=cmd_relations)
    a.add_argument("--limit", type=int)

    a = sub.add_parser("verify"); a.set_defaults(fn=cmd_verify)
    a.add_argument("--submit", action="store_true")
    a.add_argument("--collect", metavar="BATCH_ID")
    a.add_argument("--limit", type=int)

    a = sub.add_parser("validity"); a.set_defaults(fn=cmd_validity)
    a.add_argument("--min-conf", type=float, default=0.75)
    a.add_argument("--show", type=int, default=15)

    a = sub.add_parser("search"); a.set_defaults(fn=cmd_search)
    a.add_argument("query")
    a.add_argument("--as-of", help="YYYY-MM-DD; status hukum pada tanggal itu")
    a.add_argument("--limit", type=int, default=10)
    a.add_argument("--kategori", help="PPh | PPN | KUP | PBB | BM | BPHTB")
    a.add_argument("--jenis", help="PER | PMK | UU | PP | SE ...")
    a.add_argument("--tag", help="kode/nama tag katalog, mis. 2005")
    a.add_argument("--termasuk-dicabut", action="store_true")
    a.add_argument("--konteks", action="store_true", help="cetak konteks siap-RAG")

    a = sub.add_parser("daftar"); a.set_defaults(fn=cmd_daftar)
    a.add_argument("--jenis"); a.add_argument("--kategori"); a.add_argument("--tahun", type=int)
    a.add_argument("--tahun-min", type=int); a.add_argument("--cari")
    a.add_argument("--status", help="berlaku | dicabut | diubah | dicabut_sebagian")
    a.add_argument("--semua", action="store_true", help="termasuk yang tanpa teks")
    a.add_argument("--limit", type=int, default=25)

    a = sub.add_parser("buka"); a.set_defaults(fn=cmd_buka)
    a.add_argument("id", help="id kanonik, nomor, atau canonical")
    a.add_argument("--teks", action="store_true", help="cetak teks penuh")
    a.add_argument("--n", type=int, default=12, help="jumlah unit pasal ditampilkan")

    sub.add_parser("identitas").set_defaults(fn=cmd_identitas)

    a = sub.add_parser("graph"); a.set_defaults(fn=cmd_graph)
    a.add_argument("--chain", metavar="REG_ID", help="telusuri rantai perubahan")
    a.add_argument("--export", metavar="PATH.json")
    a.add_argument("--min-conf", type=float, default=0.75)

    a = sub.add_parser("ocr"); a.set_defaults(fn=cmd_ocr)
    a.add_argument("--limit", type=int)

    a = sub.add_parser("isi-celah",
                       help="ambil dokumen celah dari repositori resmi")
    a.set_defaults(fn=cmd_isi_celah)
    a.add_argument("--jalankan", action="store_true")
    a.add_argument("--jenis", help="batasi satu bentuk, mis. PMK")
    a.add_argument("--tahun-min", type=int)
    a.add_argument("--batas", type=int)
    a.add_argument("--semua-kategori", action="store_true",
                   help="jangan batasi ke kategori perpajakan")
    a.add_argument("--ortax", action="store_true",
                   help="pakai Ortax untuk yang tidak ada di sumber resmi "
                        "(termasuk Surat Edaran)")
    a.add_argument("--jeda", type=float, default=0.7)

    a = sub.add_parser("tautkan",
                       help="tautkan relasi yang sasarannya ada tapi belum terhubung")
    a.set_defaults(fn=cmd_tautkan)
    a.add_argument("--terapkan", action="store_true")

    a = sub.add_parser("unduh-pdf",
                       help="unduh pindaian resmi (hanya bentuk yang punya)")
    a.set_defaults(fn=cmd_unduh_pdf)
    a.add_argument("--jalankan", action="store_true")
    a.add_argument("--jenis", help="batasi satu bentuk, mis. UU")
    a.add_argument("--batas", type=int)
    a.add_argument("--pekerja", type=int, default=3)
    a.add_argument("--jeda", type=float, default=0.6)

    a = sub.add_parser("ulang-ortax",
                       help="ambil ulang naskah Ortax yang masih menggumpal")
    a.set_defaults(fn=cmd_ulang_ortax)
    a.add_argument("--jalankan", action="store_true")
    a.add_argument("--batas", type=int)
    a.add_argument("--pekerja", type=int, default=3)

    a = sub.add_parser("statistik",
                       help="tulis statistik korpus ke berkas Excel")
    a.set_defaults(fn=cmd_statistik)
    a.add_argument("--keluar", help="alamat berkas keluaran")

    a = sub.add_parser("kurang",
                       help="apa yang masih kurang di korpus, per jenis kekurangan")
    a.set_defaults(fn=cmd_kurang)
    a.add_argument("--tautkan-pdf", action="store_true",
                   help="tautkan dulu PDF yang sudah ada di disk ke dokumennya")

    a = sub.add_parser("integrasi",
                       help="urai, indeks, relasi, keberlakuan, tinjauan "
                            "— dalam urutan yang benar")
    a.set_defaults(fn=cmd_integrasi)
    a.add_argument("--tanpa-urai", action="store_true",
                   help="lewati penguraian ulang seluruh dokumen")
    a.add_argument("--min-conf", type=float, default=0.75)

    a = sub.add_parser("ddtc", help="katalog dan naskah DDTC (pusat/daerah)")
    a.set_defaults(fn=cmd_ddtc)
    a.add_argument("--sisi", choices=("pusat", "daerah"), default="daerah")
    a.add_argument("--ambil", action="store_true",
                   help="telusuri ulang katalognya dari DDTC")
    a.add_argument("--muat", action="store_true",
                   help="muat katalog yang sudah tersimpan dan padankan")
    a.add_argument("--banding", action="store_true",
                   help="bandingkan status DDTC dengan hitungan kita")
    a.add_argument("--jalankan", action="store_true",
                   help="ambil naskah untuk antreannya")
    a.add_argument("--batas", type=int)
    a.add_argument("--jeda", type=float, default=0.5)

    a = sub.add_parser("celah", help="bandingkan dengan katalog Ortax")
    a.set_defaults(fn=cmd_celah)
    a.add_argument("--ambil", action="store_true",
                   help="unduh ulang daftar Ortax (metadata publik saja)")
    a.add_argument("--muat", action="store_true", help="padankan ulang")
    a.add_argument("--hanya-pajak", action="store_true",
                   help="batasi ke kategori PPh/PPN/KUP/PBB/BPHTB")
    a.add_argument("--jenis", help="saring satu bentuk, mis. PMK")
    a.add_argument("--ekspor", help="tulis daftar celah ke berkas CSV")
    a.add_argument("--jeda", type=float, default=0.4)

    a = sub.add_parser("hierarki", help="peta kedudukan bentuk peraturan")
    a.set_defaults(fn=cmd_hierarki)
    a.add_argument("--berkala", action="store_true",
                   help="sertakan terbitan kurs dan tarif bunga")
    a.add_argument("--lengkapi-kode", action="store_true",
                   help="isi jenis_code yang kosong dari label jenisnya")

    a = sub.add_parser("verifikasi",
                       help="cek keberlakuan ke repositori peraturan lain")
    a.set_defaults(fn=cmd_verifikasi)
    a.add_argument("--jalankan", action="store_true", help="periksa ke internet")
    a.add_argument("--selesaikan", action="store_true",
                   help="tutup kasus yang sudah dapat diputus sumber luar")
    a.add_argument("--batas", type=int, help="jumlah peraturan yang diperiksa")
    a.add_argument("--jeda", type=float, default=1.0, help="jeda antar permintaan")

    a = sub.add_parser("berkala", help="kurs mingguan & tarif bunga bulanan")
    a.set_defaults(fn=cmd_berkala)
    a.add_argument("--bangun", action="store_true", help="urai ulang dari naskah")
    a.add_argument("--jenis", default="kurs", choices=["kurs", "tarif_bunga"])
    a.add_argument("--tanggal", help="tampilkan angka yang berlaku pada tanggal ini")

    a = sub.add_parser("tinjau", help="antrean tinjauan mutu + auto-resolve")
    a.set_defaults(fn=cmd_tinjau)
    a.add_argument("--bangun", action="store_true", help="bangun ulang antrean")
    a.add_argument("--auto", action="store_true",
                   help="terapkan usul berkeyakinan >= ambang")
    a.add_argument("--ambang", type=float, default=0.90)
    a.add_argument("--batalkan", metavar="ID_TEMUAN",
                   help="kembalikan nilai lama untuk satu temuan")

    a = sub.add_parser("sdsn", help="urai naskah konsolidasi SDSN")
    a.set_defaults(fn=cmd_sdsn)
    a.add_argument("berkas", help="PDF atau teks hasil pdftotext -layout")
    a.add_argument("--keluaran", default="data/sdsn")
    a.add_argument("--nama", default="sdsn-2023")
    a.add_argument("--tanpa-db", action="store_true",
                   help="hanya ekspor berkas, tidak menulis ke basis data")

    a = sub.add_parser("sources"); a.set_defaults(fn=cmd_sources)
    a.add_argument("--coverage", action="store_true", help="ukur cakupan tiap sumber")
    a.add_argument("--probe", metavar="URL", help="diagnostik situs yang belum terverifikasi")
    a.add_argument("--measure", action="store_true",
                   help="uji ketersediaan nyata dengan sampel berstrata")
    a.add_argument("--per-jenis", type=int, default=6)
    a.add_argument("--limit", type=int)
    a.add_argument("--jenis", help="batasi ke satu jenis, mis. UU / PP / PMK")
    a.add_argument("--all", action="store_true", help="termasuk yang sudah punya teks")
    a.add_argument("--no-pdf", action="store_true", help="ambil relasi & metadata saja")

    a = sub.add_parser("goldset"); a.set_defaults(fn=cmd_goldset)
    a.add_argument("--build-silver", action="store_true")
    a.add_argument("--sample", metavar="PATH.csv", help="'-' untuk lokasi baku")
    a.add_argument("--n", type=int, default=250)
    a.add_argument("--import-labels", metavar="PATH.csv")
    a.add_argument("--eval", action="store_true")
    a.add_argument("--tier", default="silver", choices=["silver", "gold"])

    a = sub.add_parser("refresh"); a.set_defaults(fn=cmd_refresh)
    a.add_argument("--days", type=int, default=14)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
