const STEPS = [
  {
    n: "01",
    title: "Jump in",
    body: "Log in, pick a callsign, and load straight into the live FFA deathmatch — no install, all in-browser. You spawn with a rifle.",
  },
  {
    n: "02",
    title: "Climb the board",
    body: "Efficiency wins — K/D, win-rate and accuracy drive the skill score, not raw grinding. The Top 10 board resets every 8 hours, so each window is a fresh shot at the top.",
  },
  {
    n: "03",
    title: "Get paid",
    body: "Every 8 hours the Top 10 are paid out on Solana — verifiably, straight to the wallet tied to your callsign.",
  },
];

export function HowItWorks() {
  return (
    <section className="how">
      <h2>How it <span className="accent">works</span></h2>
      <div className="how-grid">
        {STEPS.map((s) => (
          <div key={s.n} className="how-card">
            <span className="how-n">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
