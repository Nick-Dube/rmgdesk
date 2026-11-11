'use strict';
const { z } = require('zod');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB: short phone videos fit, nothing larger

const ALLOWED_UPLOAD_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const attachmentRef = z.object({
  key: z.string().max(300),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
});

const createTicketSchema = z.object({
  buildingId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  priority: z.enum(PRIORITIES),
  title: z.string().trim().min(10, 'Please give a short summary of at least 10 characters.').max(100),
  description: z.string().trim().min(1, 'Please describe the problem.').max(5000),
  locationText: z.string().trim().min(2, 'Please say where the problem is.').max(200),
  departmentName: optionalText(120),
  contactPhone: optionalText(30),
  attachments: z.array(attachmentRef).max(5, 'You can attach up to 5 files.').default([]),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  isInternal: z.boolean().optional().default(false),
});

const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().refine((t) => t in ALLOWED_UPLOAD_TYPES, 'Only photos, videos (MP4 or MOV) and PDFs can be attached.'),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 50 MB or smaller.'),
});

const listQuerySchema = z.object({
  scope: z.enum(['mine', 'assigned', 'all', 'queue']).optional().default('mine'),
  status: z.enum(['open', 'closed', 'any']).optional().default('any'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  before: z.coerce.number().int().positive().optional(),
});

module.exports = {
  MAX_UPLOAD_BYTES,
  ALLOWED_UPLOAD_TYPES,
  PRIORITIES,
  createTicketSchema,
  commentSchema,
  uploadRequestSchema,
  listQuerySchema,
};
