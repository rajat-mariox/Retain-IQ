/**
 * Productivity classification — org-configurable, applied at READ time to the
 * analytics per-app / per-site usage tables. The org's ProductivitySetting lists
 * are seeded from these defaults and edited in the org portal; changes take
 * effect immediately and everywhere (My Time, team insights, executive overview,
 * monitoring) because nothing is baked into stored aggregates.
 */
export type ProductivityCategory = "PRODUCTIVE" | "NEUTRAL" | "DISTRACTING";

export interface ProductivityRules {
  productiveApps: string[];
  productiveDomains: string[];
  distractingApps: string[];
  distractingDomains: string[];
}

// Substring-matched against the (lowercased) app/window title.
const DEFAULT_PRODUCTIVE_APPS = [
  "vscode", "visual studio code", "visual studio", "code", "intellij", "webstorm", "pycharm", "phpstorm",
  "goland", "rider", "clion", "datagrip", "rubymine", "android studio", "xcode", "sublime", "atom",
  "neovim", "vim", "emacs", "cursor", "zed", "fleet", "terminal", "iterm", "powershell", "cmd", "warp",
  "git", "github desktop", "sourcetree", "docker", "postman", "insomnia", "tableplus", "dbeaver",
  "figma", "sketch", "excel", "word", "powerpoint", "outlook", "onenote", "notion", "obsidian",
  "jira", "confluence", "linear", "slack", "microsoft teams", "teams", "zoom", "unity", "unreal",
  // local dev tooling / mail & API testing
  "mailpit", "mailhog", "maildev", "swagger", "pgadmin", "redis insight", "redisinsight",
  "kafka", "minio", "prisma studio", "storybook", "kubernetes", "k9s", "lens",
];
const DEFAULT_DISTRACTING_APPS = [
  "youtube", "netflix", "spotify", "steam", "epic games", "epicgames", "discord", "twitch",
  "instagram", "facebook", "tiktok", "snapchat", "whatsapp", "telegram", "vlc", "game",
];
const DEFAULT_PRODUCTIVE_DOMAINS = [
  // dev / R&D
  "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com",
  "developer.mozilla.org", "npmjs.com", "pypi.org", "readthedocs.io", "geeksforgeeks.org",
  "w3schools.com", "leetcode.com", "hackerrank.com", "kaggle.com", "arxiv.org", "dev.to",
  "atlassian.net", "linear.app", "notion.so", "notion.com", "figma.com", "vercel.com", "netlify.com",
  "docs.google.com", "sheets.google.com", "console.aws.amazon.com", "aws.amazon.com",
  "portal.azure.com", "console.cloud.google.com", "cloud.google.com", "digitalocean.com",
  // local dev tooling served over http (mail catchers, consoles, docs).
  // NOTE: bare localhost / 127.0.0.1 are deliberately NOT listed — anything at
  // all can be served there, so they stay NEUTRAL rather than counting as work.
  "mailpit.local", "swagger.io", "postman.co", "sentry.io",
  "grafana.com", "datadoghq.com", "supabase.com", "railway.app", "render.com",
  // AI tools
  "chatgpt.com", "chat.openai.com", "openai.com", "platform.openai.com", "claude.ai", "anthropic.com",
  "gemini.google.com", "bard.google.com", "copilot.microsoft.com", "perplexity.ai", "huggingface.co",
  "cursor.sh", "cursor.com", "poe.com", "deepseek.com", "mistral.ai", "groq.com", "replicate.com",
];
const DEFAULT_DISTRACTING_DOMAINS = [
  "youtube.com", "netflix.com", "primevideo.com", "hotstar.com", "disneyplus.com", "hulu.com",
  "instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com", "reddit.com", "twitch.tv",
  "spotify.com", "steampowered.com", "epicgames.com", "roblox.com", "ign.com", "9gag.com",
  "pinterest.com", "snapchat.com",
];

export const DEFAULT_PRODUCTIVITY_RULES: ProductivityRules = {
  productiveApps: DEFAULT_PRODUCTIVE_APPS,
  productiveDomains: DEFAULT_PRODUCTIVE_DOMAINS,
  distractingApps: DEFAULT_DISTRACTING_APPS,
  distractingDomains: DEFAULT_DISTRACTING_DOMAINS,
};

const normalizeDomain = (domain: string) => domain.toLowerCase().replace(/^www\./, "");
const domainMatches = (d: string, entry: string) => {
  const e = normalizeDomain(entry);
  return d === e || d.endsWith(`.${e}`);
};

export function classifyApp(name: string, rules: ProductivityRules): ProductivityCategory {
  const n = name.toLowerCase();
  if (rules.productiveApps.some((p) => p && n.includes(p.toLowerCase()))) return "PRODUCTIVE";
  if (rules.distractingApps.some((d) => d && n.includes(d.toLowerCase()))) return "DISTRACTING";
  return "NEUTRAL";
}

export function classifyDomain(domain: string, rules: ProductivityRules): ProductivityCategory {
  const d = normalizeDomain(domain);
  if (rules.productiveDomains.some((p) => p && domainMatches(d, p))) return "PRODUCTIVE";
  if (rules.distractingDomains.some((x) => x && domainMatches(d, x))) return "DISTRACTING";
  return "NEUTRAL";
}
