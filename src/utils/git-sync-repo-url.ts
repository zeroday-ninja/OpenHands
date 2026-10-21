import { parseGitRemoteUrl } from "#/utils/parse-git-remote-url";

/**
 * A browsable URL for a configured git sync remote, or `null` when there
 * isn't one. A bare repo on disk is a valid sync target, so a local path --
 * and anything else that doesn't parse -- stays plain text rather than
 * becoming a dead link.
 *
 * An http(s) remote is already browsable, so it is reused as-is apart from the
 * `.git` suffix and any embedded credentials, which keeps forge-specific paths
 * (Azure's `org/project/_git/repo`) and non-default ports intact. Other schemes
 * -- `ssh://`, `git://`, `git@host:owner/repo` -- carry no browsable form, so
 * they are rebuilt over https from the parsed host and repository.
 */
export function browseUrlFor(repoUrl: string): string | null {
  const parsed = parseGitRemoteUrl(repoUrl);
  if (!parsed?.host || !parsed.repository) return null;

  if (/^https?:\/\//i.test(parsed.url)) {
    const url = new URL(parsed.url);
    url.username = "";
    url.password = "";
    url.pathname = url.pathname.replace(/\.git$/, "");
    return url.toString();
  }

  return `https://${parsed.host}/${parsed.repository}`;
}

// `scheme://userinfo@`; the greedy userinfo stops at the authority's last `@`,
// where the WHATWG URL parser also ends it.
const URL_USERINFO_PATTERN = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)@/i;

/**
 * The configured remote as shown to the user, without embedded credentials.
 * Like the href, an http(s) remote loses its whole userinfo, since a token
 * often rides in the username slot alone. Other schemes keep the user, which
 * names the account (`ssh://git@host`), and lose only a password. The rest of
 * the value is shown exactly as configured.
 */
export function displayUrlFor(repoUrl: string): string {
  const url = repoUrl.trim();
  const match = url.match(URL_USERINFO_PATTERN);
  if (!match) return url;

  const [userinfoPrefix, scheme, userinfo] = match;
  const rest = url.slice(userinfoPrefix.length);
  if (/^https?:\/\/$/i.test(scheme)) return `${scheme}${rest}`;

  const passwordStart = userinfo.indexOf(":");
  if (passwordStart === -1) return url;
  return `${scheme}${userinfo.slice(0, passwordStart)}@${rest}`;
}

/**
 * How a remote is named in lists and headings: its label when the operator
 * gave it one, otherwise its repository without credentials.
 */
export function remoteDisplayName(remote: {
  label: string;
  repo_url: string;
}): string {
  return remote.label.trim() || displayUrlFor(remote.repo_url);
}
