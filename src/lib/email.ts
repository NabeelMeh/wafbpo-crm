import nodemailer from 'nodemailer';
import {assert} from './domain/errors.ts';
/** Credentials and recipient configuration are server-only. No message bodies or codes are logged. */
export async function sendSecurityCode(to:string,code:string,user:{name:string;employeeId:string}){
 assert(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASSWORD&&process.env.SMTP_FROM,503,'EMAIL_NOT_CONFIGURED','Security email delivery is not configured. Contact Management.');
 const port=Number(process.env.SMTP_PORT||465);assert([465,587].includes(port),503,'EMAIL_NOT_CONFIGURED','Configure TLS SMTP port 465 or 587.');
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:true,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,socketTimeout:15000});
 try{await transport.sendMail({from:process.env.SMTP_FROM,to,subject:'Cloud Nest BPO - new device verification',text:`A new device requested access for ${user.name} (${user.employeeId}).\n\nVerification code: ${code}\n\nExpires in five minutes. Single use. Share only with the authorized user after confirming their request. Do not forward to anyone else.`});}
 catch{throw new Error('Security email delivery failed.');}finally{transport.close();}
}
