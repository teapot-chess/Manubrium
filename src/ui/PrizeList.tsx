// The prize list under the standings, when the tournament has prize money
// (`GET /prizes`, the desk roles, as the standings are). Read-only: the
// money is set on the computer. An older server without the route, or a
// tournament without prizes, shows nothing at all.

import { useEffect, useState } from "preact/hooks";
import type { Prizes, Tournament } from "../api";
import type { Ctx } from "./App";
import { t as tr } from "../i18n";

export function PrizeList(props: { ctx: Ctx; t: Tournament; reload: number; onPlayer: (id: number) => void }) {
  const [prizes, setPrizes] = useState<Prizes | null>(null);

  useEffect(() => {
    let gone = false;
    Promise.resolve()
      .then(() => props.ctx.api.prizes(props.t.id))
      .then(
        (p) => !gone && setPrizes(p),
        () => !gone && setPrizes(null),
      );
    return () => {
      gone = true;
    };
  }, [props.ctx.api, props.t.id, props.reload]);

  if (!prizes || !prizes.configured || prizes.tables.length === 0) return null;
  return (
    <section class="prizes" id="prizes">
      <h2>{tr("prizes.title")}</h2>
      {!prizes.final && (
        <p class="fine" id="prizes-provisional">
          {tr("prizes.provisional")}
        </p>
      )}
      {prizes.tables.map((table, i) => (
        <div key={table.name ?? `general-${i}`} class="prize-table">
          <h3 class="sub">{table.name ?? tr("prizes.general")}</h3>
          <ul class="list compact">
            {table.awards.map((a) => (
              <li key={`${a.place}-${a.player.id}`} class="row">
                <span class="game-round">{a.place}</span>
                <span class="row-main static">
                  <span class="row-title">
                    <button type="button" class="link" onClick={() => props.onPlayer(a.player.id)}>
                      {a.player.title ? `${a.player.title} ` : ""}
                      {a.player.name}
                    </button>
                  </span>
                  {(a.label || a.item) && <span class="row-sub">{[a.label, a.item].filter(Boolean).join(" · ")}</span>}
                </span>
                <span class="game-result">{a.amount}</span>
              </li>
            ))}
            {table.unclaimed > 0 && (
              <li class="row">
                <span class="row-main static">
                  <span class="row-sub">{table.unclaimed === 1 ? tr("prizes.unclaimed_one") : tr("prizes.unclaimed_other", { n: table.unclaimed })}</span>
                </span>
              </li>
            )}
          </ul>
        </div>
      ))}
      {prizes.paid && <p class="fine" id="prizes-paid">{tr("prizes.paid", { amount: prizes.paid })}</p>}
    </section>
  );
}
