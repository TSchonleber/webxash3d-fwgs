const STEPS = [
  {
    n: "01",
    title: "Jump in",
    body: "Log in, pick a callsign, and load straight into the live FFA deathmatch — no install, all in-browser. You spawn with a rifle.",
  },
  {
    n: "02",
    title: "Climb the board",
    body: "Frags and headshots earn points. The leaderboard resets every 30 minutes, so every round is a fresh shot at the top.",
  },
  {
    n: "03",
    title: "Get paid",
    body: "When the round closes, the top fraggers are paid out on Solana — verifiably, straight to your wallet.",
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
