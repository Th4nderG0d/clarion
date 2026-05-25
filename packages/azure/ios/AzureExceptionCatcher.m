#import "AzureExceptionCatcher.h"

@implementation AzureExceptionCatcher

+ (BOOL)runBlock:(void (^)(void))block error:(NSError * _Nullable * _Nullable)error {
  @try {
    block();
    return YES;
  } @catch (NSException *exception) {
    if (error) {
      NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
      if (exception.reason) {
        userInfo[NSLocalizedDescriptionKey] = exception.reason;
      }
      if (exception.userInfo) {
        [userInfo addEntriesFromDictionary:exception.userInfo];
      }
      *error = [NSError errorWithDomain:exception.name ?: @"AzureExceptionCatcher"
                                   code:0
                               userInfo:userInfo];
    }
    return NO;
  }
}

@end
