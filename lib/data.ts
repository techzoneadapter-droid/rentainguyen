export type Asset = {
 id:string;
 name:string;
 type:string;
 status:string;
 verified:boolean;
 country:string;
 tier:string;
 limit:string;
 parent:string;
 source:string;
 checked?:string;
 currency?:string;
 metaStatus?:number;
 healthNote?:string;
 metaId?:string;
 verificationStatus?:string;
 creationTime?:string;
 timezoneId?:string;
 primaryPageId?:string;
 primaryPageName?:string;
 createdById?:string;
 createdByName?:string;
 adminEmail?:string;
 adminInviteStatus?:string;
 adminInviteError?:string;
 crmPushStatus?:string;
 crmPushAt?:string;
 crmResourceId?:string;
 crmBatchId?:string;
};
export type Entry = { id:string; name:string; status:string; created:string; [key:string]:unknown };
export const types = ['BM', 'TKQC', 'Page', 'Dataset/Pixel'];
export const demoAssets:Asset[] = Array.from({length:24},(_,i)=>({
 id:`demo-${i+1}`,name:i<8?['Nguyễn Media','Growth Agency','Ecommerce Việt Nam','US Performance','Saigon Digital','Global Commerce','Creative Studio','D2C Vietnam'][i]:`${i<16?'Ads':i<20?'Page':'Pixel'} · ${['Nguyễn Media','Growth Agency','Ecommerce','US Performance'][i%4]} ${i+1}`,
 type:i<8?'BM':i<16?'TKQC':i<20?'Page':'Dataset/Pixel',status:i===3||i===11?'Hạn chế':i===6?'DIE':'LIVE',verified:i%3!==0,country:i%3===0?'US':'VN',tier:['BM5','BM3','BM10','BM0'][i%4],limit:['250 USD','50 USD','1.500 USD','Chưa rõ'][i%4],parent:i<8?'':`demo-${i%8+1}`,source:'demo',currency:'USD',checked:'2026-09-10T02:30:00.000Z'
}));
