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

        <span className={styles.status}>
          <span className={styles.pulse} aria-hidden="true" />
          AI Design Engine · Online
        </span>
      </div>
    </header>
  );
}
