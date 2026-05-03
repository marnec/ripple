import "./Demo.css";

interface DemoTabProps {
  counts: any;
  organizations: any[];
  deletingId: string | null;
  lastSummary: any;
  jobStatus: any;
  handleSeedData: () => void;
  seedLarge: () => void;
  handleClearData: () => void;
  handleDeleteInline: (orgId: string) => void;
  handleDeleteBatched: (orgId: string) => void;
  seedBtnRef: React.RefObject<HTMLButtonElement | null>;
  firstInlineBtnRef: React.RefObject<HTMLButtonElement | null>;
  firstBatchedBtnRef: React.RefObject<HTMLButtonElement | null>;
}

export function DemoTab({
  counts,
  organizations,
  deletingId,
  lastSummary,
  jobStatus,
  handleSeedData,
  seedLarge,
  handleClearData,
  handleDeleteInline,
  handleDeleteBatched,
  seedBtnRef,
  firstInlineBtnRef,
  firstBatchedBtnRef,
}: DemoTabProps) {
  return (
    <div className="section">
      <h2 className="section-title">Demo</h2>
      <p className="text">
        Try out cascading deletes with a sample organizational hierarchy. Create
        sample data, then delete organizations to see how all related teams,
        members, projects, tasks, and comments are automatically cleaned up.
      </p>

      <div className="demo-controls">
        <button
          ref={seedBtnRef}
          className="demo-button primary"
          onClick={handleSeedData}
        >
          <svg
            className="button-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          Seed Sample Data
        </button>
        <button className="demo-button primary" onClick={() => seedLarge()}>
          <svg
            className="button-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          Seed Large Dataset
        </button>
        <button className="demo-button secondary" onClick={handleClearData}>
          <svg
            className="button-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Clear All Data
        </button>
      </div>

      {counts && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{counts.organizations}</div>
            <div className="stat-label">Organizations</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.teams}</div>
            <div className="stat-label">Teams</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.members}</div>
            <div className="stat-label">Members</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.projects}</div>
            <div className="stat-label">Projects</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.tasks}</div>
            <div className="stat-label">Tasks</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{counts.comments}</div>
            <div className="stat-label">Comments</div>
          </div>
        </div>
      )}

      {organizations && organizations.length > 0 && (
        <div className="organizations-list">
          <h3 className="list-title">Organizations</h3>
          {organizations.map((org: any, index: number) => (
            <div key={org._id} className="org-card">
              <div className="org-info">
                <h4 className="org-name">{org.name}</h4>
                <p className="org-description">{org.description}</p>
                <p className="org-meta">{org.teamCount} teams</p>
              </div>
              <div className="org-actions">
                <button
                  ref={index === 0 ? firstInlineBtnRef : undefined}
                  className="action-button inline"
                  onClick={() => handleDeleteInline(org._id)}
                  disabled={deletingId === org._id}
                >
                  {deletingId === org._id ? "Deleting..." : "Delete (Inline)"}
                </button>
                <button
                  ref={index === 0 ? firstBatchedBtnRef : undefined}
                  className="action-button batched"
                  onClick={() => handleDeleteBatched(org._id)}
                  disabled={deletingId === org._id}
                >
                  {deletingId === org._id ? "Deleting..." : "Delete (Batched)"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {organizations && organizations.length === 0 && (
        <div className="empty-state">
          <svg
            className="empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="empty-text">
            No data yet. Click "Seed Sample Data" to get started.
          </p>
        </div>
      )}

      {lastSummary && (
        <div className="summary-section">
          <h3 className="summary-title">Last Deletion Summary</h3>
          <div className="summary-grid">
            {Object.entries(lastSummary).map(([table, count]) => (
              <div key={table} className="summary-item">
                <span className="summary-table">{table}</span>
                <span className="summary-count">{count as number}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {jobStatus && (
        <div className="progress-section">
          <h3 className="progress-title">Batch Deletion Progress</h3>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{
                width: `${(jobStatus.completedCount / jobStatus.totalTargetCount) * 100}%`,
              }}
            />
          </div>
          <p className="progress-text">
            {jobStatus.status}: {jobStatus.completedCount} /{" "}
            {jobStatus.totalTargetCount} documents
          </p>
          {jobStatus.status === "completed" && (
            <div className="summary-grid">
              {Object.entries(JSON.parse(jobStatus.completedSummary)).map(
                ([table, count]) => (
                  <div key={table} className="summary-item">
                    <span className="summary-table">{table}</span>
                    <span className="summary-count">{count as number}</span>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
