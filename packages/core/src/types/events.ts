export interface GitHubIssueRef {
  number: number;
  title?: string;
  body?: string;
  labels?: Array<{ name?: string }>;
}

export interface GitHubRepositoryRef {
  full_name: string;
}

export interface GitHubCommentRef {
  body?: string;
  user?: { login?: string };
}

export interface GitHubIssueCommentEvent {
  action?: string;
  repository?: GitHubRepositoryRef;
  issue?: GitHubIssueRef;
  comment?: GitHubCommentRef;
}
