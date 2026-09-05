import styles from "./Header.module.css";

export function Header() {
  return (
    <header className={styles.bar}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            A
          </span>
          <span className={styles.name}>
            <span className={styles.nameTop}>ANDALA AI</span>
            <span className={styles.nameSub}>Visual Employee</span>
          </span>
        </div>

        <div className={styles.right}>
          <span className={styles.status}>
            <span className={styles.pulse} aria-hidden="true" />
            AI Design Engine · Online
          </span>
          <button type="button" className={styles.settings} aria-label="Settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2.06 2.06 0 1 1-2.91 2.91l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2.06 2.06 0 1 1-4.12 0v-.1a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2.06 2.06 0 1 1-2.91-2.91l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H4a2.06 2.06 0 1 1 0-4.12h.1a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2.06 2.06 0 1 1 2.91-2.91l.06.06a1.7 1.7 0 0 0 1.87.34H10.2A1.7 1.7 0 0 0 11.23 4.6V4.5a2.06 2.06 0 1 1 4.12 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2.06 2.06 0 1 1 2.91 2.91l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H20a2.06 2.06 0 1 1 0 4.12h-.1a1.7 1.7 0 0 0-1.56 1.03Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
