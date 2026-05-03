/*
(1.) Inserts a large non-uniform dataset for testing batched cascading deletes
(2.) Creates 9 orgs with varying sizes: from a 1-team startup (26 docs) to a 6-team enterprise (177 docs)
(3.) Every organization has a unique team/project/task/comment structure

Inserts enough documents that inline (single-transaction) deletion will hit
Convex transaction limits for larger orgs. This forces use of batched deletion mode, which
deletes in multiple scheduled transactions with progress tracking. Non-uniform data ensures
each deletion produces visibly different summary numbers in the demo UI.
*/

import { v } from "convex/values";
import { mutation } from "./_generated/server.js";

interface OrgBlueprint {
  name: string;
  description: string;
  teams: {
    name: string;
    description: string;
    members: number;
    projects: {
      name: string;
      description: string;
      status: "active" | "completed";
      tasks: number;
      commentsPerTask: number;
    }[];
  }[];
}

const orgBlueprints: OrgBlueprint[] = [
  {
    name: "TechCorp Industries",
    description: "Enterprise software and cloud services",
    teams: [
      { name: "Engineering", description: "Core product development", members: 6,
        projects: [
          { name: "Platform v2", description: "Next-gen platform rebuild", status: "active", tasks: 5, commentsPerTask: 3 },
          { name: "Mobile App", description: "Cross-platform mobile client", status: "active", tasks: 4, commentsPerTask: 2 },
          { name: "API Gateway", description: "Unified API layer", status: "completed", tasks: 3, commentsPerTask: 1 },
        ] },
      { name: "Design", description: "User experience and visual design", members: 3,
        projects: [
          { name: "Design System", description: "Component library and tokens", status: "active", tasks: 6, commentsPerTask: 2 },
          { name: "Brand Refresh", description: "New visual identity", status: "completed", tasks: 2, commentsPerTask: 0 },
        ] },
      { name: "DevOps", description: "Infrastructure and CI/CD", members: 2,
        projects: [
          { name: "K8s Migration", description: "Move to Kubernetes", status: "active", tasks: 8, commentsPerTask: 1 },
        ] },
    ],
  },
  {
    name: "Creative Labs",
    description: "Design and media production studio",
    teams: [
      { name: "Video Production", description: "Commercial video work", members: 5,
        projects: [
          { name: "Brand Campaign", description: "Q1 brand video series", status: "active", tasks: 4, commentsPerTask: 5 },
          { name: "Product Demos", description: "Feature walkthrough videos", status: "completed", tasks: 7, commentsPerTask: 1 },
        ] },
      { name: "Graphic Design", description: "Print and digital design", members: 4,
        projects: [
          { name: "Marketing Kit", description: "Sales collateral redesign", status: "active", tasks: 3, commentsPerTask: 2 },
        ] },
    ],
  },
  {
    name: "DataFlow Systems",
    description: "Data analytics and machine learning platform",
    teams: [
      { name: "Data Engineering", description: "ETL pipelines and data lakes", members: 7,
        projects: [
          { name: "Streaming Pipeline", description: "Real-time event processing", status: "active", tasks: 9, commentsPerTask: 2 },
          { name: "Data Warehouse v2", description: "Snowflake migration", status: "active", tasks: 6, commentsPerTask: 3 },
          { name: "Schema Registry", description: "Centralized schema management", status: "completed", tasks: 3, commentsPerTask: 1 },
          { name: "Data Quality", description: "Automated data validation", status: "active", tasks: 5, commentsPerTask: 2 },
        ] },
      { name: "ML Platform", description: "Model training and serving", members: 5,
        projects: [
          { name: "Feature Store", description: "Centralized feature management", status: "active", tasks: 7, commentsPerTask: 4 },
          { name: "Model Registry", description: "Versioned model storage", status: "completed", tasks: 4, commentsPerTask: 1 },
        ] },
      { name: "Visualization", description: "Dashboards and reporting", members: 3,
        projects: [
          { name: "Executive Dashboard", description: "C-suite metrics view", status: "active", tasks: 3, commentsPerTask: 1 },
        ] },
      { name: "Platform SRE", description: "Reliability and monitoring", members: 2,
        projects: [
          { name: "Alerting v2", description: "PagerDuty integration overhaul", status: "active", tasks: 4, commentsPerTask: 0 },
        ] },
    ],
  },

  {
    name: "NovaByte Startup",
    description: "Early-stage fintech startup with a lean team",
    teams: [
      { name: "Product", description: "Full-stack product team", members: 3,
        projects: [
          { name: "Payment Gateway", description: "Core payment processing", status: "active", tasks: 5, commentsPerTask: 3 },
        ] },
    ],
  },
  {
    name: "Quantum Health",
    description: "Digital health platform for remote patient monitoring",
    teams: [
      { name: "Backend", description: "Server and API development", members: 6,
        projects: [
          { name: "Patient Portal", description: "Patient-facing web app", status: "active", tasks: 8, commentsPerTask: 1 },
          { name: "Provider Dashboard", description: "Doctor-facing analytics", status: "active", tasks: 4, commentsPerTask: 3 },
        ] },
      { name: "Mobile", description: "iOS and Android development", members: 3,
        projects: [
          { name: "iOS App", description: "Native iOS client", status: "active", tasks: 6, commentsPerTask: 2 },
        ] },
    ],
  },
  {
    name: "Atlas Logistics",
    description: "Global supply chain and fleet management",
    teams: [
      { name: "Routing", description: "Route optimization algorithms", members: 5,
        projects: [
          { name: "Route Engine v3", description: "ML-based route optimization", status: "active", tasks: 7, commentsPerTask: 4 },
          { name: "Fleet Tracker", description: "Real-time GPS tracking", status: "completed", tasks: 3, commentsPerTask: 1 },
        ] },
      { name: "Warehouse", description: "Warehouse management systems", members: 4,
        projects: [
          { name: "Inventory Scanner", description: "Barcode scanning system", status: "active", tasks: 5, commentsPerTask: 2 },
          { name: "Shelf Optimizer", description: "Warehouse layout optimization", status: "active", tasks: 2, commentsPerTask: 0 },
        ] },
      { name: "Customer Success", description: "Client onboarding and support", members: 2,
        projects: [
          { name: "Onboarding Portal", description: "Self-serve onboarding flow", status: "active", tasks: 4, commentsPerTask: 1 },
        ] },
    ],
  },
  {
    name: "Pinnacle Media Group",
    description: "Digital advertising and content distribution network",
    teams: [
      { name: "Ad Platform", description: "Programmatic ad serving", members: 8,
        projects: [
          { name: "Bidding Engine", description: "Real-time auction system", status: "active", tasks: 10, commentsPerTask: 3 },
          { name: "Ad Creative Studio", description: "Self-serve ad builder", status: "active", tasks: 6, commentsPerTask: 2 },
          { name: "Fraud Detection", description: "Click fraud prevention", status: "active", tasks: 4, commentsPerTask: 5 },
        ] },
      { name: "Analytics", description: "Campaign performance analytics", members: 5,
        projects: [
          { name: "Dashboard v2", description: "Advertiser analytics dashboard", status: "active", tasks: 7, commentsPerTask: 2 },
          { name: "Attribution Model", description: "Multi-touch attribution", status: "completed", tasks: 3, commentsPerTask: 1 },
        ] },
      { name: "Content", description: "Publisher content management", members: 3,
        projects: [
          { name: "CMS Rewrite", description: "Headless CMS migration", status: "active", tasks: 9, commentsPerTask: 1 },
        ] },
      { name: "Infrastructure", description: "CDN and edge computing", members: 4,
        projects: [
          { name: "Edge Cache", description: "Global edge caching layer", status: "completed", tasks: 5, commentsPerTask: 2 },
        ] },
    ],
  },
  {
    name: "Verdant Robotics",
    description: "Agricultural robotics and precision farming",
    teams: [
      { name: "Perception", description: "Computer vision and sensor fusion", members: 7,
        projects: [
          { name: "Crop Classifier", description: "ML crop identification", status: "active", tasks: 6, commentsPerTask: 4 },
          { name: "Obstacle Avoidance", description: "Real-time path planning", status: "active", tasks: 8, commentsPerTask: 2 },
        ] },
      { name: "Mechanical", description: "Robot chassis and actuators", members: 5,
        projects: [
          { name: "Harvester Arm v4", description: "Next-gen picking mechanism", status: "active", tasks: 4, commentsPerTask: 3 },
        ] },
      { name: "Firmware", description: "Embedded systems and control loops", members: 4,
        projects: [
          { name: "Motor Controller", description: "Brushless motor driver firmware", status: "completed", tasks: 3, commentsPerTask: 1 },
          { name: "Sensor Hub", description: "Multi-sensor aggregation board", status: "active", tasks: 5, commentsPerTask: 2 },
        ] },
      { name: "Cloud Platform", description: "Farm management dashboard", members: 3,
        projects: [
          { name: "Farm Dashboard", description: "Real-time field monitoring", status: "active", tasks: 7, commentsPerTask: 1 },
          { name: "Yield Predictor", description: "Harvest yield forecasting", status: "active", tasks: 3, commentsPerTask: 0 },
        ] },
      { name: "Field Ops", description: "Deployment and field testing", members: 2,
        projects: [
          { name: "Test Harness", description: "Automated field test suite", status: "active", tasks: 2, commentsPerTask: 1 },
        ] },
    ],
  },
  {
    name: "Cipher Security",
    description: "Enterprise zero-trust security platform",
    teams: [
      { name: "Core Engine", description: "Threat detection and response", members: 6,
        projects: [
          { name: "SIEM v3", description: "Next-gen security event manager", status: "active", tasks: 12, commentsPerTask: 3 },
          { name: "Incident Response", description: "Automated incident workflows", status: "active", tasks: 5, commentsPerTask: 4 },
          { name: "Threat Intel", description: "Threat intelligence feeds", status: "completed", tasks: 3, commentsPerTask: 1 },
        ] },
      { name: "Identity", description: "Authentication and access management", members: 4,
        projects: [
          { name: "SSO Gateway", description: "SAML/OIDC federation", status: "active", tasks: 6, commentsPerTask: 2 },
          { name: "MFA Service", description: "Multi-factor authentication", status: "completed", tasks: 4, commentsPerTask: 1 },
        ] },
      { name: "Network", description: "Network security and microsegmentation", members: 3,
        projects: [
          { name: "Zero Trust Proxy", description: "Identity-aware proxy", status: "active", tasks: 8, commentsPerTask: 2 },
        ] },
      { name: "Compliance", description: "Audit and compliance reporting", members: 2,
        projects: [
          { name: "SOC2 Reporter", description: "Automated compliance reports", status: "active", tasks: 3, commentsPerTask: 1 },
          { name: "Audit Logger", description: "Tamper-proof audit trail", status: "completed", tasks: 2, commentsPerTask: 0 },
        ] },
      { name: "Research", description: "Vulnerability research and red team", members: 3,
        projects: [
          { name: "Fuzzer", description: "Protocol fuzzing framework", status: "active", tasks: 4, commentsPerTask: 2 },
        ] },
      { name: "DevSecOps", description: "Security CI/CD tooling", members: 2,
        projects: [
          { name: "Pipeline Scanner", description: "SAST/DAST integration", status: "active", tasks: 5, commentsPerTask: 1 },
          { name: "Dep Auditor", description: "Dependency vulnerability scanner", status: "active", tasks: 3, commentsPerTask: 2 },
        ] },
    ],
  },
];

const memberNames = [
  "Alice Chen", "Bob Martinez", "Carol Davis", "Dan Wilson",
  "Eva Johansson", "Frank Okafor", "Grace Kim", "Hiro Tanaka",
  "Isla Patel", "Jake Rossi", "Keiko Yamamoto", "Liam O'Brien",
];

const roles = ["Lead", "Senior", "Mid", "Junior"];
const taskStatuses = ["todo", "in_progress", "done"] as const;

/**
 * Seeds a large non-uniform dataset for stress-testing cascading deletes.
 * Creates 9 organizations with varying team counts, project sizes, and comment densities.
 */
export const seedLargeDataset = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    let firstOrgId = "";

    for (let o = 0; o < orgBlueprints.length; o++) {
      const org = orgBlueprints[o];
      const orgId = await ctx.db.insert("organizations", {
        name: org.name,
        description: org.description,
      });
      if (o === 0) firstOrgId = orgId;

      for (let t = 0; t < org.teams.length; t++) {
        const team = org.teams[t];
        const teamId = await ctx.db.insert("teams", {
          organizationId: orgId,
          name: team.name,
          description: team.description,
        });

        for (let m = 0; m < team.members; m++) {
          const memberName = memberNames[m % memberNames.length];
          await ctx.db.insert("members", {
            teamId,
            name: memberName,
            email: `${memberName.toLowerCase().replace(/[ ']/g, ".")}+t${t}o${o}@example.com`,
            role: roles[m % roles.length],
          });
        }

        for (let p = 0; p < team.projects.length; p++) {
          const proj = team.projects[p];
          const projectId = await ctx.db.insert("projects", {
            teamId,
            name: proj.name,
            description: proj.description,
            status: proj.status,
          });

          for (let tk = 0; tk < proj.tasks; tk++) {
            const taskId = await ctx.db.insert("tasks", {
              projectId,
              title: `Task ${tk + 1} for ${proj.name}`,
              description: `Implementation task ${tk + 1}`,
              status: taskStatuses[tk % taskStatuses.length],
              assignedTo: memberNames[tk % team.members],
            });

            for (let c = 0; c < proj.commentsPerTask; c++) {
              await ctx.db.insert("comments", {
                taskId,
                authorName: memberNames[(tk + c + 1) % team.members],
                text: `Comment ${c + 1} on task ${tk + 1}`,
              });
            }
          }
        }
      }
    }

    return firstOrgId;
  },
});
