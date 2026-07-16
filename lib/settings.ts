import fs from "fs";
import os from "os";
import path from "path";

export interface TaskoraSettings {
  setupComplete: boolean;
  userName: string;
  userEmail: string;
  anthropicKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  slackClientId: string;
  slackClientSecret: string;
  slackRedirectUri: string;
}

const DEFAULTS: TaskoraSettings = {
  setupComplete: false,
  userName: "",
  userEmail: "",
  anthropicKey: "",
  googleClientId: "",
  googleClientSecret: "",
  googleRedirectUri: "",
  slackClientId: "",
  slackClientSecret: "",
  slackRedirectUri: "",
};

export function getTaskoraDir(): string {
  const dir = path.join(os.homedir(), ".taskora");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function settingsPath(): string {
  return path.join(getTaskoraDir(), "settings.json");
}

export function getSettings(): TaskoraSettings {
  const file = settingsPath();
  if (!fs.existsSync(file)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as Partial<TaskoraSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(partial: Partial<TaskoraSettings>): TaskoraSettings {
  const current = getSettings();
  const next: TaskoraSettings = { ...current, ...partial };
  const file = settingsPath();
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
