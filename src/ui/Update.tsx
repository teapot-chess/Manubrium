// The Android build's update offer (src/update.ts): a sheet with the new
// version and a link to its apk. The link is a plain link on purpose -
// Capacitor sends a page off the app's origin to the phone's browser, which
// downloads it and hands it to the package installer.

import { useEffect, useState } from "preact/hooks";
import { checkForUpdate, type Update } from "../update";
import { loadPhoneSettings } from "../phoneSettings";
import { appVersion, onResume, selfUpdating, storage } from "../platform";
import { Sheet } from "./common";
import { t as tr } from "../i18n";

export function UpdateSheet(props: { update: Update; current: string; onClose: () => void }) {
  return (
    <Sheet title={tr("update.title", { version: props.update.version })} onClose={props.onClose}>
      <p>{tr("update.text", { current: props.current })}</p>
      <div class="sheet-actions">
        <a class="btn primary block" id="update-download" href={props.update.url} onClick={() => setTimeout(props.onClose, 0)}>
          {tr("update.download")}
        </a>
        <button type="button" class="btn block" id="update-later" onClick={props.onClose}>
          {tr("update.later")}
        </button>
      </div>
    </Sheet>
  );
}

/** On start and on every return to the front, at most once a day, unless switched off under More. */
export function UpdateCheck() {
  const [offer, setOffer] = useState<{ update: Update; current: string } | null>(null);

  useEffect(() => {
    if (!selfUpdating) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!(await loadPhoneSettings(storage)).checkUpdates) return;
        const current = await appVersion();
        if (!current) return;
        const answer = await checkForUpdate({ current, store: storage, fetch });
        if (answer.kind === "update") setOffer({ update: answer.update, current });
      } finally {
        busy = false;
      }
    };
    void check();
    return onResume(() => void check());
  }, []);

  return offer ? <UpdateSheet update={offer.update} current={offer.current} onClose={() => setOffer(null)} /> : null;
}
