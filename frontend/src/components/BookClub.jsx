import styles from "./styling/BookClub.module.css";

// Placeholder for the forthcoming Book Club feature. Keeping it isolated lets
// the group display setting control it without coupling future functionality
// to the status roster or module feed.
export default function BookClub() {
  return (
    <section className={styles.section} aria-label="Book Club">
      <p className={styles.title}>Book Club</p>
    </section>
  );
}
