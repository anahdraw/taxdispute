type AlphaBrandProps = {
  compact?: boolean;
  className?: string;
  inverse?: boolean;
};

export function AlphaBrand({ compact = false, className = "", inverse = false }: AlphaBrandProps) {
  return (
    <div className={`alpha-brand${compact ? " compact" : ""}${inverse ? " inverse" : ""}${className ? ` ${className}` : ""}`} aria-label="Alpha AI Jurist">
      <img src="/alpha-ai-jurist-mark.svg" alt="" aria-hidden="true" />
      {!compact && (
        <div className="alpha-brand-copy">
          <strong>Alpha <em>AI</em> Jurist</strong>
          <span>Tax Intelligence. Trusted Judgment.</span>
          <small>One-Stop Tax &amp; Legal AI Platform</small>
        </div>
      )}
    </div>
  );
}

export function AlphaTaxBotMark() {
  return (
    <div className="alpha-taxbot-mark" aria-label="Alpha AI Regulation Bot">
      <img src="/alpha-ai-jurist-mark.svg" alt="" aria-hidden="true" />
      <div>
        <strong>Alpha AI</strong>
        <small>Regulation Bot</small>
      </div>
      <i aria-hidden="true" />
    </div>
  );
}
