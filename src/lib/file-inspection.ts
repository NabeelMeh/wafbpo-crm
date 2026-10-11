/** Defense in depth, never a replacement for an independent malware scanner. */
import {inflateRawSync} from 'node:zlib';
function office(ext:string,b:Buffer):boolean {
 const end=b.length-22;
 if(end<0||b.readUInt32LE(end)!==0x06054b50||b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+20))return false;
 const count=b.readUInt16LE(end+10),start=b.readUInt32LE(end+16),cdsize=b.readUInt32LE(end+12);
 if(!count||count>2000||count!==b.readUInt16LE(end+8)||start+cdsize!==end)return false;
 let pos=start,total=0;const names=new Set<string>();
 for(let i=0;i<count;i++){
  if(pos+46>end||b.readUInt32LE(pos)!==0x02014b50)return false;
  const flags=b.readUInt16LE(pos+8),method=b.readUInt16LE(pos+10),compressed=b.readUInt32LE(pos+20),raw=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),offset=b.readUInt32LE(pos+42);
  if(flags&1||![0,8].includes(method)||raw>16*1024*1024||(raw>100000&&raw/Math.max(1,compressed)>100)||pos+46+n+extra+comment>end)return false;
  const name=b.subarray(pos+46,pos+46+n).toString('utf8');
  if(!name||name.includes('..')||name.includes('\\')||name.startsWith('/')||/[\x00-\x1f:]/.test(name)||names.has(name)||/vbaProject|activeX|embeddings|\.exe$|\.js$/i.test(name))return false;
  names.add(name);total+=raw;if(total>64*1024*1024)return false;
  if(offset+30>start||b.readUInt32LE(offset)!==0x04034b50)return false;
  const ln=b.readUInt16LE(offset+26),le=b.readUInt16LE(offset+28),dataStart=offset+30+ln+le;
  if(dataStart+compressed>start||b.subarray(offset+30,offset+30+ln).toString('utf8')!==name||b.readUInt16LE(offset+8)!==method||b.readUInt16LE(offset+6)!==flags)return false;
  const data=b.subarray(dataStart,dataStart+compressed),expanded=method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,raw)}):data;
  if(expanded.length!==raw)return false;
  if(/\.(xml|rels)$/i.test(name)&&/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*['"]External['"]|<script|DDEAUTO/i.test(expanded.toString('utf8')))return false;
  pos+=46+n+extra+comment;
 }
 return pos===end&&names.has('[Content_Types].xml')&&names.has(ext==='docx'?'word/document.xml':'xl/workbook.xml');
}
export function inspectFile(name:string,_type:string,b:Buffer):boolean {
 try {
  const ext=name.split('.').at(-1)?.toLowerCase();
  if(!b.length)return false;
  switch(ext){
   case 'pdf':return b.subarray(0,8).toString('ascii').startsWith('%PDF-')&&!/\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA)\b/i.test(b.toString('latin1'));
   case 'txt':case 'csv':{const t=new TextDecoder('utf-8',{fatal:true}).decode(b);return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)&&!/<\s*(script|html|iframe|svg|object)|<!DOCTYPE/i.test(t);}
   case 'docx':case 'xlsx':return office(ext,b);
   case 'doc':case 'xls':return b.length>=512&&b.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1';
   case 'png':return b.length>=24&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&b.subarray(12,16).toString()==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0&&b.readUInt32BE(16)*b.readUInt32BE(20)<=40000000;
   case 'jpg':case 'jpeg':return b.length>=4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217;
   case 'webp':return b.length>=16&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
   case 'mp3':return b.length>4&&(b.subarray(0,3).toString()==='ID3'||(b[0]===255&&(b[1]&224)===224));
   case 'wav':return b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE';
   case 'm4a':return b.length>=12&&b.subarray(4,8).toString()==='ftyp';
   case 'aac':return b.length>=7&&b[0]===255&&(b[1]&246)===240;
   case 'ogg':return b.length>=27&&b.subarray(0,4).toString()==='OggS';
   case 'webm':return b.length>=8&&b.subarray(0,4).toString('hex')==='1a45dfa3';
   default:return false;
  }
 }catch{return false;}
}
