import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";
import styles from "./Field.module.css";

export type FieldProps = {
  readonly label: ReactNode;
  readonly htmlFor?: string;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly children: ReactNode;
  readonly inline?: boolean;
};

/** label → control → hint / error. The control is one of the styled inputs below. */
export function Field({ label, htmlFor, hint, error, children, inline = false }: FieldProps) {
  return (
    <div className={inline ? `${styles.field} ${styles.inline}` : styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint}>{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[styles.control, className].filter(Boolean).join(" ")} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={styles.selectWrap}>
      <select className={[styles.control, styles.select, className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </select>
      <svg className={styles.selectChevron} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={[styles.control, styles.textarea, className].filter(Boolean).join(" ")} {...rest} />
  );
}
