/**
 * Cross-platform browser opener — opens a URL in the user's default browser.
 * Falls back silently (prints URL for manual copy-paste).
 */

import { execFile } from "node:child_process";

export function openBrowser(url: string): void {
  const platform = process.platform;

  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    // Linux and others
    cmd = "xdg-open";
    args = [url];
  }

  execFile(cmd, args, (err) => {
    if (err) {
      // Silent failure — URL is already shown in terminal for manual use
    }
  });
}
