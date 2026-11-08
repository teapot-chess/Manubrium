import { render } from "preact";
import { App } from "./ui/App";
import { AppLock } from "./ui/AppLock";
import { storage } from "./platform";
import { loadTheme, setTheme, startTheme } from "./themes";
import "./styles.css";

// The default palette at once, the remembered one a moment later: the
// frame in between is Slate either way, never unstyled.
startTheme();
loadTheme(storage).then(setTheme);

render(
  <AppLock>
    <App />
  </AppLock>,
  document.getElementById("app")!,
);
