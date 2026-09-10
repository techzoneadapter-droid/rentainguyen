import { z } from 'zod';
const id=z.string().min(1).max(200);
export const jobSchema=z.object({
 operation:z.enum(['create','share','member','connect','remove-member','remove-partner','detach']),
 name:z.string().trim().min(1).max(200),prefix:z.string().trim().max(100).optional(),type:z.enum(['BM','TKQC','Page','Dataset/Pixel']).optional(),
 count:z.coerce.number().int().min(1).max(100),interval:z.coerce.number().int().min(5).max(3600),
 assetIds:z.array(id).max(100).default([]),parent:z.string().max(200).optional(),
 email:z.union([z.string().email(),z.literal('')]).optional(),businessEmail:z.union([z.string().email(),z.literal('')]).optional(),role:z.enum(['EMPLOYEE','ADMIN','ANALYZE','ADVERTISE','MANAGE']).default('EMPLOYEE'),partner:z.string().regex(/^\d{5,30}$/).optional(),
 targetId:z.string().regex(/^\d{5,30}$/).optional(),random:z.boolean().optional(),
 currency:z.enum(['USD','VND','EUR']).default('USD'),timezone:z.coerce.number().int().min(1).max(1000).default(1),
 category:z.string().max(100).optional(),about:z.string().max(1000).optional(),
 });
export const requestSchema=z.object({action:z.string(),asset:z.unknown().optional(),job:jobSchema.optional(),ids:z.array(id).max(100).optional(),id:id.optional(),
 service:z.object({name:z.string().trim().min(1).max(150),provider:z.string().trim().min(1).max(150),description:z.string().max(3000).optional(),category:z.string().max(100).optional(),price:z.string().max(100).optional(),url:z.union([z.string().url(),z.literal('')]).optional()}).optional()});
export type JobInput=z.infer<typeof jobSchema>;
