import { describe, it, expect, vi, beforeEach } from "vitest";
import { RewardApi } from "./api";

const json = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(data) } as Response);

describe("RewardApi", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("fetches the leaderboard for an hour", async () => {
    const fetchMock = vi.fn().mockReturnValue(json([{ wallet: "W", kills: 10, deaths: 3, matches: 1, rank: 1 }]));
    vi.stubGlobal("fetch", fetchMock);
    const api = new RewardApi("http://localhost:8787");
    const board = await api.leaderboard(100);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/leaderboard/100");
    expect(board[0].wallet).toBe("W");
  });

  it("returns null claim for a non-winner (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(json({ error: "not a winner" }, 404)));
    const api = new RewardApi("http://localhost:8787");
    expect(await api.claim(100, "W")).toBeNull();
  });

  it("returns claim args for a winner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(json({ periodId: 100, index: 0, amount: "500000000", proof: ["aa"] })));
    const api = new RewardApi("http://localhost:8787");
    const claim = await api.claim(100, "W");
    expect(claim?.amount).toBe("500000000");
  });
});
