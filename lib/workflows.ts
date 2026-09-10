import { db, list, put, audit, config } from './server';
import type { JobInput } from './validation';
import type { Asset } from './data';
export type Step={path:string;method:'POST'|'DELETE';params:Record<string,string>;label:string;assetType?:string;assetName?:string;parent?:string;resultId?:string;status?:string;error?:string};
export type Job=JobInput & {id:string;created:string;status:string;reason:string;completed:number;steps?:Step[];cursor?:number;nextAt?:number;startedAt?:number};
export function metaId(a:Asset|undefined){if(!a||a.source!=='meta')throw new Error('Chỉ thực thi với tài nguyên thật đã đồng bộ từ Meta.');const id=a.id.split('meta:')[1];if(!/^(act_)?\d+$/.test(id||''))throw new Error('ID Meta không hợp lệ.');return id;}
export function plan(j:JobInput,assets:Asset[]):Step[]{
 const steps:Step[]=[];const parent=assets.find(a=>a.id===j.parent);const name=j.prefix||j.name;
 if(j.operation==='create'){
  if(j.type==='BM'&&!j.businessEmail)throw new Error('Cần email doanh nghiệp để tạo BM.');
  if(j.type==='Page'&&!j.category)throw new Error('Cần ID danh mục Meta để tạo Page.');
  if(j.type==='TKQC'&&parent?.type!=='BM')throw new Error('Chọn BM sở hữu TKQC.');
  if(j.type==='Dataset/Pixel'&&parent?.type!=='TKQC')throw new Error('Chọn TKQC sở hữu Pixel.');
  for(let i=0;i<j.count;i++){const resourceName=`${name} ${String(i+1).padStart(3,'0')}`;const params:Record<string,string>={name:resourceName};let path='';
   if(j.type==='BM'){path='me/businesses';Object.assign(params,{email:j.businessEmail!,timezone_id:String(j.timezone),vertical:'ADVERTISING'});}
   else if(j.type==='TKQC'){const id=metaId(parent);path=`${id}/adaccount`;Object.assign(params,{currency:j.currency,timezone_id:String(j.timezone),end_advertiser:id,media_agency:'NONE',partner:'NONE'});}
   else if(j.type==='Page'){path='me/accounts';Object.assign(params,{category:j.category!,about:j.about||resourceName});}
   else if(j.type==='Dataset/Pixel')path=`${metaId(parent)}/adspixels`;
   else throw new Error('Loại tài nguyên không hợp lệ.');
   steps.push({path,method:'POST',params,label:`Tạo ${resourceName}`,assetType:j.type,assetName:resourceName,parent:j.parent});
   if(j.type==='BM'&&j.email)steps.push({path:`$result:${steps.length-1}/business_users`,method:'POST',params:{email:j.email,role:j.role==='ADMIN'?'ADMIN':'EMPLOYEE'},label:`Mời ${j.email} vào ${resourceName}`});
  }
 }else if(j.operation==='share'){
  if(!j.partner||!['ANALYZE','ADVERTISE','MANAGE'].includes(j.role))throw new Error('ID đối tác hoặc quyền chia sẻ không hợp lệ.');
  if(!j.assetIds.length)throw new Error('Chọn tài khoản quảng cáo.');
  for(const id of j.assetIds){const a=assets.find(x=>x.id===id);if(a?.type!=='TKQC'||a.parent!==j.parent)throw new Error('TKQC không thuộc BM được chọn.');steps.push({path:`${metaId(a)}/agencies`,method:'POST',params:{business:j.partner,permitted_tasks:JSON.stringify([j.role])},label:`Chia sẻ ${a.name} cho ${j.partner}`});}
 }else if(j.operation==='member'){
  if(parent?.type!=='BM'||!j.email)throw new Error('Chọn BM và email thành viên.');
  steps.push({path:`${metaId(parent)}/business_users`,method:'POST',params:{email:j.email,role:j.role==='ADMIN'?'ADMIN':'EMPLOYEE'},label:`Mời ${j.email}`});
 }else throw new Error('Thao tác này cần thực hiện trong Meta Business Settings. Cấu hình đã được lưu để đối chiếu.');
 return steps;
}
export async function start(user:string,id:string){
 if(!config().token)throw new Error('Chưa kết nối Meta.');
 const jobs=await list(user,'job') as Job[];const j=jobs.find(j=>j.id===id);if(!j)throw new Error('Không tìm thấy workflow.');
 if(!['Chờ cấu hình Meta','Đã lưu cấu hình'].includes(j.status))throw new Error('Workflow đã bắt đầu hoặc đã hủy.');
 const steps=plan(j,await list(user,'asset'));
 const value={...j,steps,cursor:0,status:'Đang chạy',reason:'Hàng đợi xử lý khi ứng dụng đang mở. Mỗi thao tác được ghi nhận riêng.',nextAt:Date.now()};
 const update=await db().prepare('UPDATE records SET payload = ? WHERE owner = ? AND id = ? AND payload = ?').bind(JSON.stringify(value),user,id,JSON.stringify(j)).run();if(!update.meta.changes)throw new Error('Workflow vừa thay đổi. Tải lại để tiếp tục.');await audit(user,`Bắt đầu ${j.name}`).run();
}
export async function tick(user:string){
 const jobs=await list(user,'job') as Job[];const j=jobs.find(j=>j.status==='Đang chạy'&&(j.nextAt||0)<=Date.now());if(!j)return false;
 const index=j.cursor||0;const step=j.steps?.[index];if(!step)throw new Error('Không tìm thấy bước thực thi.');
 const busy={...j,status:'Đang thực thi',startedAt:Date.now(),reason:'Đang chờ kết quả Meta. Nếu mất kết nối, cần đối chiếu trước khi chạy lại.'};
 const claimed=await db().prepare('UPDATE records SET payload = ? WHERE owner = ? AND id = ? AND payload = ?').bind(JSON.stringify(busy),user,j.id,JSON.stringify(j)).run();if(!claimed.meta.changes)return false;
 try{
  let path=step.path;if(path.startsWith('$result:')){const match=/^\$result:(\d+)(\/.*)$/.exec(path)!;const result=j.steps![Number(match[1])].resultId;if(!result)throw new Error('Không có ID của bước tạo trước.');path=result+match[2];}
  const c=config();if(!c.token)throw new Error('Kết nối Meta bị thiếu.');
  const response=await fetch(`https://graph.facebook.com/${c.version}/${path}`,{method:step.method,headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(step.params),signal:AbortSignal.timeout(25000)});
  const data=await response.json() as {id?:string;success?:boolean;error?:{message:string;code:number}};
  if(!response.ok||data.error)throw new Error(`Meta ${data.error?.code||response.status}: ${data.error?.message||'Không thể thực hiện thao tác'}`);
  if(step.assetType&&!data.id)throw new Error('Meta không trả ID tài nguyên. Cần đối chiếu kết quả, không tự thử lại.');
  const steps=j.steps!.map((s,i)=>i===index?{...s,status:'Hoàn tất',resultId:data.id}:s);const done=index+1===steps.length;
  const updated={...j,steps,cursor:index+1,completed:steps.filter(s=>s.status==='Hoàn tất').length,status:done?'Hoàn tất':'Đang chạy',nextAt:Date.now()+j.interval*1000,reason:done?'Đã hoàn tất các bước. Đồng bộ Meta để cập nhật đầy đủ trạng thái.':`Đã xong ${index+1}/${steps.length} thao tác. Đang chờ khoảng nghỉ.`};
  const writes=[put(user,'job',updated),audit(user,step.label)];
  if(step.assetType&&data.id)writes.push(put(user,'asset',{id:`${user}:meta:${data.id}`,name:step.assetName,type:step.assetType,source:'meta',status:'Chưa kiểm tra',verified:false,country:'Chưa rõ',tier:'Chưa rõ',limit:'Chưa rõ',parent:step.parent||''}));
  await db().batch(writes);
 }catch(e){await db().batch([put(user,'job',{...j,status:'Cần đối chiếu',reason:(e as Error).message,steps:j.steps!.map((s,i)=>i===index?{...s,status:'Cần đối chiếu',error:(e as Error).message}:s)}),audit(user,`${step.label} • ${(e as Error).message}`,'Cần đối chiếu')]);}
 return true;
}
