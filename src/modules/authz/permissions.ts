export const INSTRUCTOR_PERMISSIONS = [
  "view_assigned_classes",
  "edit_assigned_classes",
  "manage_attendance",
  "view_assigned_rosters",
  "view_class_revenue",
  "cancel_assigned_classes",
  "process_refunds",
  "create_classes",
  "edit_class_pricing",
] as const;

export type InstructorPermission = (typeof INSTRUCTOR_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<InstructorPermission, string> = {
  view_assigned_classes: "View assigned classes",
  edit_assigned_classes: "Edit assigned classes",
  manage_attendance: "Manage attendance",
  view_assigned_rosters: "View assigned rosters",
  view_class_revenue: "View class revenue",
  cancel_assigned_classes: "Cancel assigned classes",
  process_refunds: "Process refunds",
  create_classes: "Create classes",
  edit_class_pricing: "Edit class pricing",
};
