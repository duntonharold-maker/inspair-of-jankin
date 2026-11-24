/** Link to the GitHub repository, shown in the footer. */
export function repoUrl() {
  const slug =
    process.env.GITHUB_REPO ||
    (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : "duntonharold-maker/inspair-of-jankin");
  return `https://github.com/${slug}`;
}
