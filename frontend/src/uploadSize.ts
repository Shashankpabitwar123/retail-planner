// The service limits bytes in powers of 1024; keep display and validation aligned.
export function fileSize(bytes:number, remaining=false):string {
 if(bytes<1024)return `${bytes} B`;
 const unit=bytes>=1024*1024?'MB':'KB';
 const amount=bytes/(unit==='MB'?1024*1024:1024);
 const value=remaining?Math.floor(amount*100)/100:Math.ceil(amount*100)/100;
 return `${value.toLocaleString('en-US',{maximumFractionDigits:2})} ${unit}`;
}
export function uploadProblem(files:File[],maxBytes:number):string|null {
 if(files.length>12)return 'You can choose up to 12 CSV files. Remove a file before adding another.';
 if(files.some(f=>!f.name.toLowerCase().endsWith('.csv')))return 'Please choose CSV files only.';
 const total=files.reduce((sum,f)=>sum+f.size,0);
 if(total>maxBytes)return `These files are ${fileSize(total-maxBytes)} over the ${fileSize(maxBytes)} total limit. Choose smaller files or remove a file.`;
 return null;
}
