// Reading records share account/workbench scoped persistence with the other workbenches.
export const READING_KINDS=['reading_book','reading_entry'];
export const READING_FIELDS={
 reading_book:['title','date','note','author','materialType','readerFileId','status','totalPages','currentPage'],
 reading_entry:['title','date','note','bookId','entryType','page','minutes','quote','annotationType','startOffset','endOffset','fileId','color'],
};
export const READING_SCHEMA={
 annotationType:{type:'string',enum:['highlight','note']},fileId:{type:'string',minLength:1,maxLength:100},color:{type:'string',enum:['yellow','green','blue','pink']},
 startOffset:{type:'integer',minimum:0,maximum:10000000},endOffset:{type:'integer',minimum:0,maximum:10000000},
 readerFileId:{type:'string',maxLength:100},
 materialType:{type:'string',enum:['book','paper','article','report','other']},
 author:{type:'string',maxLength:250},bookId:{type:'string',minLength:1,maxLength:100},
 entryType:{type:'string',enum:['session','excerpt','qa']},quote:{type:'string',maxLength:20000},
 totalPages:{type:'integer',minimum:1,maximum:1000000},currentPage:{type:'integer',minimum:0,maximum:1000000},
 page:{type:'integer',minimum:0,maximum:1000000},minutes:{type:'integer',minimum:1,maximum:1440},
};
export function validateReading(kind,body,{validDate,bad,today}){
 const out={};
 for(const key of READING_FIELDS[kind]){
  const value=body[key];if(value===undefined||value===null||value==='')continue;
  if(['totalPages','currentPage','page','minutes','startOffset','endOffset'].includes(key)){
   const rule=READING_SCHEMA[key];
   if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim()||!Number.isInteger(Number(value))||Number(value)<rule.minimum||Number(value)>rule.maximum)throw bad('请填写有效的整数',key);
   out[key]=Number(value);
  }else{
   const max=key==='note'?5000:key==='title'?120:READING_SCHEMA[key]?.maxLength||250;
   if(typeof value!=='string'||value.length>max)throw bad('阅读字段格式或长度无效',key);
   out[key]=key==='quote'&&body.annotationType?value:value.trim();
  }
 }
 if(!out.title)throw bad('请填写名称','title');
 if(!validDate(out.date))throw bad('请选择有效日期','date');
 out.note??='';
 if(kind==='reading_book'){
  out.materialType??='book';
  if(!READING_SCHEMA.materialType.enum.includes(out.materialType))throw bad('材料类型无效','materialType');
  out.author??='';out.status??='wish';
  if(!['wish','reading','finished','paused'].includes(out.status))throw bad('阅读状态无效','status');
  if(out.totalPages!==undefined&&out.currentPage!==undefined&&out.currentPage>out.totalPages)throw bad('当前页不能超过总页数','currentPage');
 }else{
  if(!out.bookId)throw bad('请先选择所属书籍','bookId');
  if(out.date>today())throw bad('阅读记录不能使用未来日期，请将计划放到待办中','date');
  out.entryType??='session';if(!['session','excerpt','qa'].includes(out.entryType))throw bad('请选择阅读记录或摘录','entryType');
  out.quote??='';
  if(out.annotationType!==undefined){
   if(!READING_SCHEMA.annotationType.enum.includes(out.annotationType))throw bad('标注类型无效','annotationType');
   if(!out.fileId||!Number.isInteger(out.page)||out.page<1)throw bad('标注需要所属文件和页码','fileId');
   if(out.annotationType==='highlight'&&!out.quote)throw bad('划线需要选中的原文','quote');
   if(out.annotationType==='note'&&!out.note)throw bad('请填写笔记内容','note');
  }
  if(out.color!==undefined&&!READING_SCHEMA.color.enum.includes(out.color))throw bad('标注颜色无效','color');
  if((out.startOffset===undefined)!==(out.endOffset===undefined)||out.startOffset!==undefined&&out.endOffset<=out.startOffset)throw bad('标注文字范围无效','endOffset');
  if(['excerpt','qa'].includes(out.entryType)&&!out.quote&&!out.note)throw bad('摘录请填写原文或笔记','quote');
 }
 return out;
}
export function assertReadingPage(entry,book,bad){if(entry.page!==undefined&&book.totalPages!==undefined&&entry.page>book.totalPages)throw bad('记录页码不能超过书籍总页数','page');}
