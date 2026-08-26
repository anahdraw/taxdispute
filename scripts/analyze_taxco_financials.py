import json


revenue = [564, 2160, 6840, 15840, 30000]  # Rp mm
cogs = [250, 800, 1950, 3800, 6000]  # Rp mm
gross_profit = [r - c for r, c in zip(revenue, cogs)]
gross_margin = [g / r for g, r in zip(gross_profit, revenue)]
opex = [2400, 3010, 3942, 4147.2, 6482.48]  # Rp mm
ebitda = [g - o for g, o in zip(gross_profit, opex)]
initial_capital = 4000  # Rp mm


def npv(rate, cashflows):
    return sum(cf / ((1 + rate) ** i) for i, cf in enumerate(cashflows))


def irr(cashflows):
    lo, hi = -0.99, 5.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(mid, cashflows) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def payback(cashflows):
    cumulative = cashflows[0]
    for i in range(1, len(cashflows)):
        previous = cumulative
        cumulative += cashflows[i]
        if cumulative >= 0:
            return (i - 1) + (-previous / cashflows[i])
    return None


base_cashflows = [-initial_capital] + ebitda
scenarios = {
    "Worst-case": 0.6,
    "Basic": 0.8,
    "Baseline": 1.0,
    "Moderate": 1.4,
}

result = {
    "base": {
        "years": ["FY1", "FY2", "FY3", "FY4", "FY5"],
        "revenue": revenue,
        "cogs": cogs,
        "gross_profit": gross_profit,
        "gross_margin": gross_margin,
        "opex": opex,
        "ebitda": ebitda,
        "cumulative_ebitda": [sum(ebitda[:i]) for i in range(1, 6)],
        "initial_capital": initial_capital,
        "npv_12": npv(0.12, base_cashflows),
        "npv_15": npv(0.15, base_cashflows),
        "npv_20": npv(0.20, base_cashflows),
        "irr": irr(base_cashflows),
        "payback_years": payback(base_cashflows),
        "roi_5y_ebitda_to_initial": sum(ebitda) / initial_capital,
        "bep_revenue": [o / gm for o, gm in zip(opex, gross_margin)],
    },
    "scenarios": {},
}

for name, multiplier in scenarios.items():
    scenario_revenue = [r * multiplier for r in revenue]
    scenario_gp = [scenario_revenue[i] * gross_margin[i] for i in range(5)]
    scenario_ebitda = [scenario_gp[i] - opex[i] for i in range(5)]
    cashflows = [-initial_capital] + scenario_ebitda
    result["scenarios"][name] = {
        "multiplier": multiplier,
        "revenue": scenario_revenue,
        "ebitda": scenario_ebitda,
        "npv_15": npv(0.15, cashflows),
        "irr": irr(cashflows),
        "payback_years": payback(cashflows),
    }

print(json.dumps(result, indent=2))
