#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Bridges Objective-C `@throw NSException` (which Swift's `try` cannot catch)
 * into a Swift-catchable NSError.
 *
 * SFSpeechRecognizer and AVAudioEngine occasionally raise NSException (e.g.
 * on certain init failures). Without this trampoline those crash the app
 * instead of bubbling as a typed Clarion error.
 */
@interface RecognizerExceptionCatcher : NSObject

/// Runs `block`. If it raises an NSException, the exception is caught,
/// converted to NSError (domain = `exception.name`, userInfo carries
/// `reason`), and returned via `*error`. Returns YES on success, NO otherwise.
+ (BOOL)runBlock:(__attribute__((noescape)) void (^)(void))block
           error:(NSError * _Nullable * _Nullable)error;

@end

NS_ASSUME_NONNULL_END
