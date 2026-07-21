// Pure action catalog + types — no server-only imports, safe in client components.
// The runtime tool implementations live in agent-actions.ts (server-only).

export interface AgentActionConfig {
  enabled: boolean;
  guideline: string;
}
export type AgentActions = Record<string, AgentActionConfig>;

export const ACTION_DEFS: {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  premium?: boolean;
}[] = [
  {
    key: "close",
    label: "Close conversations",
    description: "Resolve the conversation when the customer's need is fully handled.",
    placeholder: "Close the conversation once the customer confirms they're all set. Don't close if they still have an open question.",
  },
  {
    key: "assign",
    label: "Assign to a teammate",
    description: "Hand the conversation to a human teammate (marks it pending and notifies them).",
    placeholder: "If the customer asks for a human, or mentions billing or a complaint, assign to the right teammate.",
  },
  {
    key: "note",
    label: "Add internal comment",
    description: "Leave a private note for the team — a summary and suggested next step.",
    placeholder: "When handing off, add a short summary of what the customer wants and what to do next.",
  },
  {
    key: "label",
    label: "Update labels / lifecycle",
    description: "Tag the conversation or move its lifecycle stage by applying a label.",
    placeholder: "Apply the 'Demo scheduled' label once the customer confirms a demo booking.",
  },
  {
    key: "contactField",
    label: "Read & update CRM properties",
    description: "Collect and store values into any object property (contact, company, deal, and custom objects) addressed as object.key.",
    placeholder: "Collect the customer's first name, budget, and project details, and store them in contact.firstName, contact.budget, project.name, and project.location.",
  },
  {
    key: "workflow",
    label: "Trigger workflows",
    description: "Run an existing automation workflow.",
    placeholder: "Trigger the onboarding workflow once the customer signs up.",
    premium: true,
  },
  {
    key: "calls",
    label: "Handle calls",
    description: "Let the agent answer and manage voice calls.",
    placeholder: "",
    premium: true,
  },
  {
    key: "http",
    label: "Make HTTP requests",
    description: "Fetch data or trigger external actions via API.",
    placeholder: "",
    premium: true,
  },
];
