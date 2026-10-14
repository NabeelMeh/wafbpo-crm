import {assert} from './errors.ts';
export type FileKind='PDF'|'DOCUMENT'|'IMAGE'|'RECORDING'|'LOGO';
type Rule={mime:string;kind:FileKind;maxMB:number;aliases?:string[]};
export const FILE_TYPES:Record<string,Rule>={
 pdf:{mime:'application/pdf',kind:'PDF',maxMB:25},
 doc:{mime:'application/msword',kind:'DOCUMENT',maxMB:25},
 docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',kind:'DOCUMENT',maxMB:25},
 xls:{mime:'application/vnd.ms-excel',kind:'DOCUMENT',maxMB:25},
 xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',kind:'DOCUMENT',maxMB:25},
 csv:{mime:'text/csv',kind:'DOCUMENT',maxMB:25,aliases:['application/vnd.ms-excel','text/plain']},
 txt:{mime:'text/plain',kind:'DOCUMENT',maxMB:25},
 png:{mime:'image/png',kind:'IMAGE',maxMB:10},jpg:{mime:'image/jpeg',kind:'IMAGE',maxMB:10},jpeg:{mime:'image/jpeg',kind:'IMAGE',maxMB:10},webp:{mime:'image/webp',kind:'IMAGE',maxMB:10},
 mp3:{mime:'audio/mpeg',kind:'RECORDING',maxMB:100,aliases:['audio/mp3']},wav:{mime:'audio/wav',kind:'RECORDING',maxMB:100,aliases:['audio/x-wav','audio/wave']},
 m4a:{mime:'audio/mp4',kind:'RECORDING',maxMB:100,aliases:['audio/x-m4a']},aac:{mime:'audio/aac',kind:'RECORDING',maxMB:100},
 ogg:{mime:'audio/ogg',kind:'RECORDING',maxMB:100,aliases:['application/ogg']},webm:{mime:'audio/webm',kind:'RECORDING',maxMB:100,aliases:['video/webm']}
};
export function validateFileMetadata(name:string,type:string,size:number,logo=false) {
 assert(typeof name==='string'&&name.length>0&&name.length<=180&&!/[\\/\x00-\x1f\x7f]/.test(name)&&!name.startsWith('.')&&!/[. ]$/.test(name),400,'INVALID_FILE','Use a simple file name without path separators or control characters.');
 const ext=name.split('.').at(-1)!.toLowerCase(),rule=FILE_TYPES[ext];
 assert(rule,400,'INVALID_FILE','This file format is not approved. Executables, SVG and macro-enabled formats are blocked.');
 assert(!logo||rule.kind==='IMAGE',400,'INVALID_LOGO','Use a PNG, JPEG or WebP logo.');
 assert(!type||type==='application/octet-stream'||type===rule.mime||rule.aliases?.includes(type),400,'INVALID_FILE','The extension and declared file type do not agree.');
 const maxMB=logo?2:rule.maxMB;
 assert(Number.isSafeInteger(size)&&size>0&&size<=maxMB*1024*1024,400,'INVALID_FILE',`File size must be between 1 byte and ${maxMB} MB.`);
 return {name,type:rule.mime,size,kind:logo?'LOGO' as const:rule.kind,ext,maxMB};
}
// Lead attachments are limited to formats the built-in inspection can verify structurally.
export const LEAD_ATTACHMENT_KINDS:FileKind[]=['PDF','RECORDING'];
export function assertLeadAttachment(kind:FileKind){assert(LEAD_ATTACHMENT_KINDS.includes(kind),400,'INVALID_FILE','Lead attachments must be PDF documents or audio recordings.');}
export const FILE_ACCEPT=Object.entries(FILE_TYPES).filter(([,rule])=>LEAD_ATTACHMENT_KINDS.includes(rule.kind)).map(([ext])=>`.${ext}`).join(',');
