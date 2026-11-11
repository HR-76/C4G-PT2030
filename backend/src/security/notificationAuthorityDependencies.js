'use strict';
// This dependency grants no authority: prepare must authorize both operations.
// It only admits the exact self-inbox read paired with deadline synchronization.
function allowsNotificationReadDependency(operationCode,intention,resource,item,organizationId){
 return operationCode==='NOTIFICATION_SYNC'&&intention?.operation==='NOTIFICATION_REFRESH_LIST'
  &&resource?.resourceType==='NOTIFICATION_INBOX'&&resource.id===organizationId&&resource.organizationId===organizationId
  &&item?.operationCode==='NOTIFICATION_READ'&&item.resource?.resourceType==='NOTIFICATION_INBOX'
  &&item.resource.id===organizationId&&item.resource.organizationId===organizationId;
}
module.exports={allowsNotificationReadDependency};
