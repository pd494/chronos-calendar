import { z } from 'zod'

export const todoFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  completed: z.boolean(),
  dueDate: z.string().optional(), // YYYY-MM-DD
  listId: z.string(),
})

export type TodoFormData = z.infer<typeof todoFormSchema>

export const listFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name is too long'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format'),
  icon: z.string().optional(),
})

export type ListFormData = z.infer<typeof listFormSchema>

export const getDefaultTodoValues = (): TodoFormData => ({
  title: '',
  completed: false,
  listId: 'inbox',
})
