import "./App.css";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { TourOverlay } from "./TourOverlay";
import { DemoTab } from "./DemoTab";
import { OverviewTab } from "./OverviewTab";

function App() {
  const [activeTab, setActiveTab] = useState<"overview" | "demo">(() => {
    const saved = localStorage.getItem("activeTab");
    return saved === "demo" || saved === "overview" ? saved : "overview";
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<any>(null);
  const [tourStep, setTourStep] = useState<number>(() => {
    const completed = localStorage.getItem("tourCompleted");
    return completed ? -1 : 0;
  });

  const demoTabRef = useRef<HTMLButtonElement>(null);
  const seedBtnRef = useRef<HTMLButtonElement>(null);
  const firstInlineBtnRef = useRef<HTMLButtonElement>(null);
  const firstBatchedBtnRef = useRef<HTMLButtonElement>(null);

  const handleTabChange = (tab: "overview" | "demo") => {
    setActiveTab(tab);
    localStorage.setItem("activeTab", tab);
    if (tab === "demo" && tourStep === 1) {
      setTourStep(2);
    }
  };

  const completeTour = () => {
    setTourStep(-1);
    localStorage.setItem("tourCompleted", "true");
  };

  const skipTour = () => completeTour();

  useEffect(() => {
    if (tourStep === 0) {
      const timer = setTimeout(() => setTourStep(1), 800);
      return () => clearTimeout(timer);
    }
  }, [tourStep]);

  const organizations = useQuery(api.queries.getAllOrganizations);
  const counts = useQuery(api.queries.getDocumentCounts);
  const jobStatus = useQuery(
    api.queries.getDeletionJobStatus,
    jobId ? { jobId } : "skip"
  );

  const seedData = useMutation(api.seed.seedSampleData);
  const seedLarge = useMutation(api.seedLarge.seedLargeDataset);
  const clearData = useMutation(api.deletions.clearAllData);
  const deleteOrg = useMutation(api.deletions.deleteOrganization);
  const deleteOrgBatched = useMutation(
    api.deletions.deleteOrganizationBatched
  );

  const handleSeedData = async () => {
    await seedData();
    if (tourStep === 2) setTourStep(3);
  };

  const handleClearData = async () => {
    await clearData();
    setLastSummary(null);
    setJobId(null);
  };

  const handleDeleteInline = async (orgId: string) => {
    setDeletingId(orgId);
    setLastSummary(null);
    setJobId(null);
    try {
      const summary = await deleteOrg({ organizationId: orgId as any });
      setLastSummary(summary);
      if (tourStep === 3) setTourStep(4);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteBatched = async (orgId: string) => {
    setDeletingId(orgId);
    setLastSummary(null);
    setJobId(null);
    try {
      const result = await deleteOrgBatched({
        organizationId: orgId as any,
        batchSize: 100,
      });
      setJobId(result.jobId);
      setLastSummary(result.initialSummary);
      if (tourStep === 4) setTimeout(completeTour, 2000);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="app-container">
      <TourOverlay
        tourStep={tourStep}
        setTourStep={setTourStep}
        skipTour={skipTour}
        demoTabRef={demoTabRef as React.RefObject<HTMLButtonElement | null>}
        seedBtnRef={seedBtnRef as React.RefObject<HTMLButtonElement | null>}
        firstInlineBtnRef={firstInlineBtnRef as React.RefObject<HTMLButtonElement | null>}
        firstBatchedBtnRef={firstBatchedBtnRef as React.RefObject<HTMLButtonElement | null>}
        organizationsLength={organizations?.length}
      />

      <header className="header">
        <h1 className="title">Cascading Delete</h1>
        <p className="subtitle">
          Manage cascading deletes across related documents in Convex
        </p>
      </header>

      <nav className="nav">
        <button
          className={`nav-item ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => handleTabChange("overview")}
        >
          Overview
        </button>
        <button
          ref={demoTabRef}
          className={`nav-item ${activeTab === "demo" ? "active" : ""}`}
          onClick={() => handleTabChange("demo")}
        >
          Demo
        </button>
      </nav>

      <main className="content">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "demo" && (
          <DemoTab
            counts={counts}
            organizations={organizations || []}
            deletingId={deletingId}
            lastSummary={lastSummary}
            jobStatus={jobStatus}
            handleSeedData={handleSeedData}
            seedLarge={seedLarge}
            handleClearData={handleClearData}
            handleDeleteInline={handleDeleteInline}
            handleDeleteBatched={handleDeleteBatched}
            seedBtnRef={seedBtnRef as React.RefObject<HTMLButtonElement | null>}
            firstInlineBtnRef={firstInlineBtnRef as React.RefObject<HTMLButtonElement | null>}
            firstBatchedBtnRef={firstBatchedBtnRef as React.RefObject<HTMLButtonElement | null>}
          />
        )}
      </main>

      <footer className="footer">
        <p className="footer-text">
          Built for the Convex Components Authoring Challenge
        </p>
      </footer>
    </div>
  );
}

export default App;
