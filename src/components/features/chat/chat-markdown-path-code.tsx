import React, { createContext, useContext } from "react";
import type { ExtraProps } from "react-markdown";
import ConversationService from "#/api/conversation-service/conversation-service.api";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { useWorkspaceFiles } from "#/hooks/query/use-workspace-files";
import { openWorkspaceFile } from "#/services/canvas-ui";
import { looksLikeWorkspaceFilePath, toFilesTabPath } from "#/utils/path-utils";
import { cn } from "#/utils/utils";
import { code as defaultCode } from "../markdown/code";
import { anchor as defaultAnchor } from "../markdown/anchor";

/** True while rendering Markdown descendants of an existing `<a>`. */
const InMarkdownLinkContext = createContext(false);

/**
 * Workspace paths available for chat Markdown linking. Absent outside
 * ChatInterface (e.g. unit tests) so ChatCode never requires QueryClient.
 */
export const WorkspaceFilesForChatContext = createContext<string[] | undefined>(
  undefined,
);

/** Fetches workspace files once for the chat tree and exposes them to path links. */
export function WorkspaceFilesForChatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data } = useWorkspaceFiles();
  return (
    <WorkspaceFilesForChatContext.Provider value={data}>
      {children}
    </WorkspaceFilesForChatContext.Provider>
  );
}

type CodeProps = React.ClassAttributes<HTMLElement> &
  React.HTMLAttributes<HTMLElement> &
  ExtraProps;

type AnchorProps = React.ClassAttributes<HTMLAnchorElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement> &
  ExtraProps;

type StrongProps = React.ClassAttributes<HTMLElement> &
  React.HTMLAttributes<HTMLElement> &
  ExtraProps;

/** Flatten React children to plain text, or null if mixed nodes. */
function getPlainText(children: React.ReactNode): string | null {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    const parts = children.map(getPlainText);
    if (parts.some((part) => part === null)) return null;
    return parts.join("");
  }
  return null;
}

/**
 * Only link paths that currently exist in the conversation workspace.
 * workingDir comes from ConversationService — same source as navigate_to_file.
 */
function useExistingWorkspacePath(candidate: string): string | null {
  const files = useContext(WorkspaceFilesForChatContext);
  if (!files?.length || !looksLikeWorkspaceFilePath(candidate)) return null;

  const workingDir =
    ConversationService.getCurrentConversation()?.workspace?.working_dir;
  const normalized = toFilesTabPath(candidate, workingDir);
  if (!normalized) return null;
  return files.includes(normalized) ? normalized : null;
}

function ChatMarkdownPathLink({
  path,
  className,
  children,
}: {
  path: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { conversationId } = useOptionalConversationId();

  return (
    <button
      type="button"
      data-testid="markdown-file-path-link"
      title={path}
      className={cn(
        className,
        "cursor-pointer rounded border border-surface-raised bg-surface-raised px-[0.4em] py-[0.2em] font-mono text-foreground hover:underline",
      )}
      onClick={(event) => {
        event.stopPropagation();
        openWorkspaceFile(path, conversationId);
      }}
    >
      {children}
    </button>
  );
}

/**
 * Chat-only inline code: existing workspace paths become Files-drawer buttons.
 * Nested under an existing Markdown link → stay plain `<code>`.
 */
export function ChatCode(props: CodeProps) {
  const { children, className } = props;
  const inLink = useContext(InMarkdownLinkContext);
  const match = /language-(\w+)/.exec(className || "");
  const codeString = String(children).replace(/\n$/, "");
  const isMultiline = String(children).includes("\n");
  const existingPath = useExistingWorkspacePath(
    !match && !isMultiline && !inLink ? codeString : "",
  );

  if (existingPath) {
    return (
      <ChatMarkdownPathLink path={existingPath} className={className}>
        {children}
      </ChatMarkdownPathLink>
    );
  }

  return defaultCode(props);
}

/**
 * Agents often emphasize paths with `**file.md**` instead of backticks.
 * Link those only when the whole strong span is an existing workspace file.
 */
export function ChatStrong(props: StrongProps) {
  const { children } = props;
  const inLink = useContext(InMarkdownLinkContext);
  const text = getPlainText(children)?.trim() ?? "";
  const existingPath = useExistingWorkspacePath(!inLink ? text : "");

  if (existingPath) {
    return (
      <ChatMarkdownPathLink path={existingPath}>
        {children}
      </ChatMarkdownPathLink>
    );
  }

  return <strong>{children}</strong>;
}

// `scheme:` or protocol-relative `//host`: a real link, not a path.
const EXTERNAL_HREF = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * The workspace file a Markdown link points at, or null for an ordinary link.
 *
 * Agents write `[prompt.md](/workspace/project/prompt.md)` for files they
 * created. Rendered as a plain anchor that resolves against the app's own
 * origin and lands on the not-found route, so a sandbox path is opened in
 * the Files drawer instead. A link counts as one when it has no scheme and
 * either sits under the conversation's working directory or names a file
 * (`file://` paths included); other same-origin links, such as an app route,
 * stay anchors.
 */
function workspaceLinkTarget(href: string | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const path = trimmed.replace(/^file:\/\//i, "");
  if (EXTERNAL_HREF.test(path)) return null;

  const workingDir =
    ConversationService.getCurrentConversation()?.workspace?.working_dir;
  const relative = toFilesTabPath(path, workingDir);
  if (!relative) return null;

  const underWorkingDir = path !== relative && path.startsWith("/");
  if (!underWorkingDir && !looksLikeWorkspaceFilePath(path)) return null;
  return relative;
}

/**
 * Chat-only link: a workspace file path opens in the Files drawer; anything
 * else is the default anchor, with its descendants marked so nested path
 * tokens are not turned into a button of their own.
 */
export function ChatAnchor(props: AnchorProps) {
  const { href, children } = props;
  const { conversationId } = useOptionalConversationId();
  const target = workspaceLinkTarget(href);

  if (target) {
    return (
      <button
        type="button"
        data-testid="markdown-file-path-link"
        title={target}
        className="cursor-pointer text-link underline"
        onClick={(event) => {
          event.stopPropagation();
          openWorkspaceFile(target, conversationId);
        }}
      >
        {children}
      </button>
    );
  }

  return (
    <InMarkdownLinkContext.Provider value>
      {defaultAnchor(props)}
    </InMarkdownLinkContext.Provider>
  );
}
