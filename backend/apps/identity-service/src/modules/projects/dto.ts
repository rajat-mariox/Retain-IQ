import { z } from "zod";

const projectStatus = z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]);
const taskStatus = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"]);
const taskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  status: projectStatus.optional(),
  ownerEmployeeId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).nullable(),
    status: projectStatus,
    ownerEmployeeId: z.string().uuid().nullable(),
    teamId: z.string().uuid().nullable(),
    clientId: z.string().uuid().nullable(),
    startDate: z.string().datetime().nullable(),
    dueDate: z.string().datetime().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: taskStatus.optional(),
  priority: taskPriority.optional(),
  assigneeEmployeeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    status: taskStatus,
    priority: taskPriority,
    assigneeEmployeeId: z.string().uuid().nullable(),
    dueDate: z.string().datetime().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const addTaskCommentSchema = z.object({
  body: z.string().trim().min(1, "Write something before posting.").max(4000),
});
export type AddTaskCommentInput = z.infer<typeof addTaskCommentSchema>;

const milestoneStatus = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]);
export const createMilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: milestoneStatus.optional(),
  ownerEmployeeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    status: milestoneStatus,
    ownerEmployeeId: z.string().uuid().nullable(),
    dueDate: z.string().datetime().nullable(),
    progress: z.coerce.number().int().min(0).max(100),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

const goalStatus = z.enum(["ACTIVE", "ACHIEVED", "MISSED", "ARCHIVED"]);
export const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  metric: z.string().max(120).nullable().optional(),
  target: z.coerce.number().nullable().optional(),
  current: z.coerce.number().optional(),
  ownerEmployeeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    status: goalStatus,
    metric: z.string().max(120).nullable(),
    target: z.coerce.number().nullable(),
    current: z.coerce.number(),
    ownerEmployeeId: z.string().uuid().nullable(),
    dueDate: z.string().datetime().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

const labelEntry = z.object({ key: z.string().max(30), label: z.string().min(1).max(40), color: z.string().max(24) });
export const updateProjectSettingsSchema = z
  .object({
    statuses: z.array(labelEntry).max(20),
    priorities: z.array(labelEntry).max(20),
    defaultProjectStatus: projectStatus,
    defaultTaskPriority: taskPriority,
    workflow: z
      .object({
        requireTaskAssignee: z.boolean(),
        autoCompleteProject: z.boolean(),
        autoReopenProject: z.boolean(),
        blockPastDueTasks: z.boolean(),
      })
      .partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
export type UpdateProjectSettingsInput = z.infer<typeof updateProjectSettingsSchema>;
