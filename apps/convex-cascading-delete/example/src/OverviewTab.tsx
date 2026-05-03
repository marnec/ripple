export function OverviewTab() {
  return (
    <div className="section">
      <h2 className="section-title">What is Cascading Delete?</h2>
      <p className="text">
        A Convex component that automatically deletes related documents when you
        delete a parent document. Configure relationships via existing indexes,
        then delete documents safely knowing all related records will be cleaned
        up automatically.
      </p>

      <div className="feature-grid">
        <div className="feature-card">
          <svg
            className="feature-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="feature-title">Configure Once</h3>
          <p className="feature-text">
            Define cascade relationships using your existing indexes
          </p>
        </div>

        <div className="feature-card">
          <svg
            className="feature-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h3 className="feature-title">Delete Safely</h3>
          <p className="feature-text">
            Automatically clean up all related records with one function call
          </p>
        </div>

        <div className="feature-card">
          <svg
            className="feature-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="feature-title">Consistency Guaranteed</h3>
          <p className="feature-text">
            Batch processing with explicit consistency semantics
          </p>
        </div>
      </div>

      <div className="code-section">
        <h3 className="code-title">Quick Example</h3>
        <pre className="code-block">
          <code>{`import { CascadingDelete, defineCascadeRules } from "@00akshatsinha00/convex-cascading-delete";

const cascadeRules = defineCascadeRules({
  users: [
    { to: "posts", via: "by_author", field: "authorId" },
    { to: "comments", via: "by_author", field: "authorId" }
  ],
  posts: [
    { to: "comments", via: "by_post", field: "postId" }
  ]
});

const cd = new CascadingDelete(components.convexCascadingDelete, {
  rules: cascadeRules
});

// Delete user and all related data
const summary = await cd.deleteWithCascade(ctx, "users", userId);
// Returns: { users: 1, posts: 5, comments: 23 }`}</code>
        </pre>
      </div>
    </div>
  );
}
