
/*global Parse, console */

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
  response.success("Hello world!");
});

// some globals
var Chat = Parse.Object.extend("Chat");
var Contact = Parse.Object.extend("Contact");
var UserMatch = Parse.Object.extend("UserMatch");
var Plan = Parse.Object.extend("Plan");
var Location = Parse.Object.extend("Location");

var eightYetUserEmail = "8yet@outlook.com";
var testUserEmails = ["chloe_ywjcbyl_test@tfbnw.net", "lisa_lgeglyp_leob@tfbnw.net", "jason_plynrfh_lee@tfbnw.net", "alessandra_srpohud_ambrosio@tfbnw.net"];
var greetingMsg = "Woohoo! You guys are lunch buddies for today. Go ahead and figure out where and when to meet. I'll check back with you guys later.";

Parse.Cloud.define("getPlanDetails", function(request, response) {
    var planId = request.params.planId;

    if (planId === undefined) {
        return response.error("getPlanDetails: invalid request parameters");
    }
    
    var query = new Parse.Query(Plan);
    query.include("host");
    query.include("location");
    query.include("participants");
    query.include("participants.pointer"); // fetch the full participants list, not just a list of pointers.
    //TODO: should not return chat to users who's not part of the plan
    query.include("chat");
    query.include("chat.lastMsgFromUser");
    query.include("chat.users");
    query.include("chat.users.pointer");
    
    query.get(planId).then(function(plan){
        response.success(plan);
    }, function(error){
        response.error("Error on getPlanDetails: " + JSON.stringify(error));
    });
});

Parse.Cloud.define("findNearbyPlans", function(request, response) {
    var results = [];
    var user = request.user;
    var latitude = request.params.latitude;
    var longitude = request.params.longitude;
    var fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    if (user === undefined || latitude === undefined || longitude === undefined) {
        return response.error("findNearbyPlans: Invalid request parameters");
    }
    
    var userLocation = new Parse.GeoPoint({latitude: latitude, longitude: longitude});
    var query = new Parse.Query(Plan);
    query.near("geo", userLocation);
    query.greaterThan("startTime", fifteenMinsAgo);
    query.include("host");
    query.include("location");
    query.include("participants");
    query.include("participants.pointer"); // fetch the full participants list, not just a list of pointers.
    query.limit(100);
    
    query.find().then(function(results){
        response.success(results);
    }, function(error){
        response.error("Error on findNearbyPlans query. " + JSON.stringify(error));
    });
});

Parse.Cloud.define("findMyTodaysPlan", function(request, response) {
    var user = request.user;
    var fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    if (user === undefined) {
        return response.error("findMyTodaysPlan: Invalid request parameters");
    }
    
    var query = new Parse.Query(Plan);
    query.greaterThan("startTime", fifteenMinsAgo);
    query.equalTo("participants", user);
    query.include("host");
    query.include("chat");
    query.include("chat.lastMsgFromUser");
    query.include("chat.users");
    query.include("chat.users.pointer");
    query.include("location");
    query.include("participants");
    query.include("participants.pointer"); // fetch the full participants list, not just a list of pointers.
    
    query.find().then(function(results) {
        response.success(results);
    }, function(error){
        response.error("Error on findMyTodaysPlan query. " + JSON.stringify(error));
    });
});

Parse.Cloud.afterSave("Swipe", function(request) {
	var now = new Date();
	var sinceTime = now.getTime() - 30 * 60 * 1000; // 30 mins ago
	var sinceDate = new Date(sinceTime);

	var swipe = request.object;
    // check that the last swipe from the other user, if exist, is a like swipe
	if (swipe.get("isLike") === true && swipe.get("isMatched") === false){
		var query = new Parse.Query("Swipe");
		query.equalTo("toUser", swipe.get("fromUser"));
		query.equalTo("fromUser", swipe.get("toUser"));
		query.equalTo("isMatched", false);
		query.greaterThan("updatedAt", sinceDate);
        query.descending("updatedAt");
		query.include("fromUser");
		query.include("toUser");
		query.first().then(function(matchingSwipe) {
			if (matchingSwipe !== undefined && matchingSwipe.get("isLike") === true) {
                console.log("matching swipes: " + matchingSwipe.id);

				// update both swipes to matched so we don't matches these swipes any more
				matchingSwipe.set("isMatched", true);
				swipe.set("isMatched", true);
				matchingSwipe.save();
				swipe.save();
                
                var fromUser = matchingSwipe.get("fromUser");
                var toUser = matchingSwipe.get("toUser");
                
                // NOTE, these upserts are not thread safe and 100% bullet proof. If both user happens to swipe each other
                // at exact the same time, we could end up with two inserts, causing duplicate records 
				var p1 = upSertContact(fromUser, toUser);
				var p2 = upSertContact(toUser, fromUser);
                var p3 = upSertUserMatch(fromUser, toUser);
                var p4 = upSertUserMatch(toUser, fromUser);
				var p5 = upSertChat([fromUser, toUser]);
                var p6 = get8YetUser();

				Parse.Promise.when([p1, p2, p3, p4, p5, p6]).then(function(r1, r2, r3, r4, r5, r6){
                    var fromUserMatch = r3;
                    var toUserMatch = r4;
					var chat = r5;
                    var eightYetUser = r6;                    
					console.log("User match chat: " + chat.id);
                    
                    var isFirstMatch = fromUserMatch.get("matchCount") === 1 && toUserMatch.get("matchCount") === 1;
                    if (isFirstMatch) {
                        sendMsgForChat(chat, eightYetUser, greetingMsg);
                        fromUserMatch.set("chat", chat);
                        toUserMatch.set("chat", chat);
                        fromUserMatch.save();
                        toUserMatch.save();
                        insertFirebaseUserMatch(fromUserMatch);
                        insertFirebaseUserMatch(toUserMatch);
                    }
                    
                    var numMatchesFromUser = fromUser.get("numMatches") ? fromUser.get("numMatches") + 1: 1;
                    fromUser.set("numMatches", numMatchesFromUser);
                    fromUser.save(null, { useMasterKey: true }).then(function() {
                        console.log("fromUser " + fromUser.get("firstName") + " saved successfully");
                    }, function(error) {
                        console.error("Failed to save fromUser " + fromUser.get("firstName") + ": " + JSON.stringify(error));
                    });
                    
                    var numMatchesToUser = toUser.get("numMatches") ? toUser.get("numMatches") + 1: 1;
                    toUser.set("numMatches", numMatchesToUser);
                    toUser.save(null, { useMasterKey: true }).then(function() {
                        console.log("toUser " + toUser.get("firstName") + " saved successfully");
                    }, function(error) {
                        console.error("Failed to save toUser " + toUser.get("firstName") + ": " + JSON.stringify(error));
                    });
                    
					// send out notifications to both users
					var installQuery = new Parse.Query(Parse.Installation);
					console.log("installQuery owners: [" + fromUser.id + ", " + toUser.id + "]");
					installQuery.containedIn("owner", [fromUser, toUser]);
					Parse.Push.send({
						where: installQuery, // Set our Installation query
						data: {
							alert: "You've got a lunch buddy!",
							badge: "Increment",
							type: "USER_MATCH",
                            sound: "default",
							chatId: chat.id
						}
					}, {
						success: function() {
							// Push was successful
							console.log("USER_MATCH notification sent successfully");
						},
						error: function(error) {
							// Handle error
							console.error(error);
						}
					});
				});
			}
		});
	}
});

// NOTE: not used any more
// send a message to the toUser of the swipe that some has liked him/her
function sendSecretLikeMsg(swipe) {
    var msg = "Someone wants to be your lunch buddy today. See if the feeling is mutual. Swipe responsibly. :) Reply 'stop' to stop receiving this message.";
    var toUser = swipe.get("toUser");

    // sanity check
    if (swipe.get("isLike") === false) {
        return;
    }

    // only send message to toUser if the user hasn't be active in last 3 days
    toUser.fetch({ useMasterKey: true }).then(function(){
        // Everytime user opens the app, we'll fetch his location and save with User object
        // so updatedAt is loosely indicative when the user used the app last time
        if (Date.now() - toUser.updatedAt.getTime() > 3 * 24 * 60 * 60 * 1000) {
            console.log("User hasn't been active in 3 days. userId=" + toUser.id);
            // check if user has turned off notification for secret like msg
            var preferenceQuery = new Parse.Query("Preference");
            preferenceQuery.equalTo("user", toUser);
            preferenceQuery.first().then(function(preference) {
                if (preference !== undefined && preference.get("secretLikeNotification") === false) {
                    console.log("secretLikeNotification turned off for userId=" + toUser.id);
                    return;
                }
                // only send the secret like msg to the "toUser" no more than once a day
                var swipeQuery = new Parse.Query("Swipe");
                swipeQuery.equalTo("toUser", toUser);
                swipeQuery.equalTo("isLike", true);
                swipeQuery.greaterThan("secretLikeMsgSentTime", new Date(Date.now() - 24 * 60 * 60 * 1000));
                swipeQuery.first().then(function(lastSwipe) {
                    if (lastSwipe === undefined) {
                        console.log("secretLikeMsg hasn't been sent for userId=" + toUser.id + " within last 24 hours");
                        get8YetUser().then(function(eightYetUser) {
                            var chatQuery = new Parse.Query("Chat");
                            chatQuery.include("users");
                            chatQuery.containsAll("users", [toUser, eightYetUser]);
                            chatQuery.find().then(function(chats) {
                                if (chats !== undefined) {
                                    chats.forEach(function(chat) {
                                        console.log("sendSecretLikeMsg for swipe=" + swipe.id);
                                        // make sure it's the chat that has just 8Yet user and the toUser and no one else
                                        if (chat.get("users").length === 2) {
                                            sendMsgForChat(chat, eightYetUser, msg);
                                            swipe.set("secretLikeMsgSentTime", new Date());
                                            swipe.save();
                                        }
                                    });
                                }
                            });
                        });
                    } else {
                        console.log("secretLikeMsg already sent for userId=" + toUser.id + " within last 24 hours");
                    }
                });
            });
        } else {
            console.log("User has been active since last 3 days. Skip sending secret like message. userId=" + toUser.id);
        }
    }, function(error) {
        console.error("sendSecretLikeMsg. Failed to fetch userId=" + toUser.id);
    });


}

// add user to owner's contact list as a temporary
// if the contact already exists, change it to permanent
function upSertContact(owner, user){
    if (owner === undefined || user === undefined) {
        return Parse.Promise.error("Can't create Contact with null user");
    }
	var query = new Parse.Query("Contact");
	var contact;
	query.equalTo("owner", owner);
	query.equalTo("user", user);
	return query.first().then(function(result){
		if (result !== undefined){
            return result;
        } else {
			contact = new Contact();
			contact.set("owner", owner);
			contact.set("user", user);
			contact.set("expires", false);
            console.log("upSertContact saving contact: " + JSON.stringify(contact.toJSON()));
            return contact.save();
		}
	});
}

function upSertChat(users){
    if (users === undefined) {
        return Parse.Promise.error("Can't create Chat with null user");
    }
    console.log("upSertChat. users: " + users.map(function(user){return user.id;}).join(","));

	var chat;
	var query = new Parse.Query("Chat");
    query.include("users");
    query.containsAll("users", users);
    query.limit(1000); // TODO: assuming no more than 1000 chats that matches the criteria
	return query.find().then(function(chats){
        var filteredChats = [];
        if (chats !== undefined) {
            filteredChats = chats.filter(function(chat) { return chat.get("users").length === 2;});
        }
        if (filteredChats.length === 0) {
            chat = new Chat();
            chat.set("expires", false);
            chat.set("users", users);
            console.log("upSertChat saving chat: ", JSON.stringify(chat.toJSON()));
            return chat.save();
        } else {
            return filteredChats[0];
        }
	});
}

function upSertUserMatch(fromUser, toUser){
    if (fromUser === undefined || toUser === undefined) {
        return Parse.Promise.error("Can't create UserMatch with null user");
    }
    console.log("upSertUserMatch. fromUser: " + JSON.stringify(fromUser.toJSON()) + ", toUser: " + JSON.stringify(toUser.toJSON()));
	var userMatch;
	var query = new Parse.Query("UserMatch");
    query.equalTo("fromUser", fromUser);
    query.equalTo("toUser", toUser);
	return query.first().then(function(result){
        if (result === undefined) {
            console.log("userMatch doesn't exist, create a new one");
            userMatch = new UserMatch();
            userMatch.set("fromUser", fromUser);
            userMatch.set("toUser", toUser);
            userMatch.set("matchCount", 1);
        } else {
            console.log("userMatch already exists: id=" + result.id);
            userMatch = result;
            userMatch.increment("matchCount");
        }
        console.log("upUserMatch saving userMatch: ", JSON.stringify(userMatch.toJSON()));
		return userMatch.save();
	},
    function(error) {
        console.error("upsertUserMatch error: " + JSON.stringify(error));
    });
}

function getParseConfig() {
    return Parse.Config.get().then(function (config) {
        return config;
    }, function(error) {
        return Parse.Config.current();
    });
}

Parse.Cloud.define("findNewVersionUsers", function(request, response) {
    var results = [];
    var user = request.user;
    
    if (user === undefined) {
        return response.error("Bad request. Missing user info");
    }
    
    if (user.get("email") !== "8yet@outlook.com") {
        return response.error("Bad request");
    }
    
    var query = new Parse.Query(Parse.Installation);
    query.include("owner");
    query.startsWith("appVersion", "2.1");
    query.exists("owner");

    query.find({ useMasterKey: true }).then(function(installations){
        installations.forEach(function(installation) {
            results.push(installation.get("owner"));
        });
        response.success(results);
    }, function(error){
        response.error("Error on findChatList query. " + error.message);
    });
});

// find the list of Chats for the given user
Parse.Cloud.define("findChatList", function(request, response) {
    var results = [];
    var user = request.user;
    
    if (user === undefined) {
        return response.error("Bad request. Missing user info");
    }
    
    var query = new Parse.Query(Chat);
    query.include("users");
    query.equalTo("users", user);

    query.each(function(chat){
        // decided not to expire chats for now. see what the users want
//        if (chat.get("expires") === true){
//            var createdAt = chat.createdAt;
//            // skip if it has expired (2 hours)
//            if (Date.now() - createdAt.getTime() > 2 * 60 * 60 * 1000) {
//                return;
//            }
//        }
        results.push(chat);
    }).then(function(){
        results = results.sort(function(a,b){
            var lastMsgTimeA = a.get("lastMsgTime") === undefined ? 0 : a.get("lastMsgTime");
            var lastMsgTimeB = b.get("lastMsgTime") === undefined ? 0 : b.get("lastMsgTime");
            return lastMsgTimeB - lastMsgTimeA;
        });
        response.success(results);
    }, function(error){
        response.error("Error on findChatList query. " + error.message);
    });
});

Parse.Cloud.define("saveFriendList", function(request, response) {
    var user = request.user;
    var friendIds = request.params.friendIds.split(",");
    if (user === undefined || friendIds === undefined) {
        return response.error("Invalid request parameters");
    }
    console.log("saveFriendList for userId=" + user.id);
    var query = new Parse.Query(Parse.User);
    query.containedIn("facebookId", friendIds);
    query.limit(1000); // TODO: assuming no more than 1000 friends
    query.find().then(function(friends){
        user.set("friends", friends);
        console.log("### saveFriendList. token=" + user.getSessionToken());
        return user.save(null, { sessionToken: user.getSessionToken() }).then(function(savedUser) {
            var promises = [];
            if (friends !== undefined) {
                friends.forEach(function(friend) {
                    promises.push(addFriendToContact(user, friend));
                });
            }
            return Parse.Promise.when(promises);
        });
    }).then(function(){
        response.success("friend list saved successfully");
    }, function(error) {
        response.error("error saving friend list: " + JSON.stringify(error));
    });
});

// Friends of the user get automatically added to contact list and chat list
function addFriendToContact(user, friend) {
    console.log("addFriendToContact. userId=" + user.id + ", friendId=" + friend.id);
    return Parse.Promise.when(upSertContact(user, friend), upSertChat([user, friend]));
}

// find nearby users who's opened the app within last 30 minutes
Parse.Cloud.define("findNearbyActiveUser", function(request, response) {
    var results = [];
    var user = request.user;
    var latitude = request.params.latitude;
    var longitude = request.params.longitude;
    var fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    
    if (user === undefined || latitude === undefined || longitude === undefined) {
        return response.error("Invalid request parameters");
    }
    
    var userLocation = new Parse.GeoPoint({latitude: latitude, longitude: longitude});
    var query = new Parse.Query(Parse.User);
    query.notEqualTo("objectId", user.id);
    query.notEqualTo("email", eightYetUserEmail); // exclude the 8yet user
    query.withinMiles("lastKnownLocation", userLocation, 5);
    // TODO: uncomment this when shipping. Commented out for testing purpose since we don't have other users opening apps frequently yet
    // query.greaterThan("updatedAt", fourHoursAgo);
    query.include("friends");

    query.each(function(user){
        results.push(user);
    }).then(function(){
        results = results.sort(function(a,b){return b.updatedAt.getTime() - a.updatedAt.getTime();});
        response.success(results);
    }, function(error){
        response.error("Error on findNearbyActiveUser query. " + JSON.stringify(error));
    });
});

// find the list of UserMatch records that haven't been responded by the user
// and needs a review (at least 4 hours past the createdAt time so there's 
// enough time to meet for lunch
Parse.Cloud.define("findUnreviewedMatches", function(request, response) {
    var user = request.user;
    findUnreviewedUserMatch(user).then(function(userMatches){
        return response.success(userMatches);
    }, function(error){
        return response.error("Error on findUnreviewedMatches query. " + JSON.stringify(error));
    });
});

// this job finds the list of users who has unreviewed user match and sends SILENT
// notifications to those users. Once the app receives the notifications, it will
// check which user match the user hasn't reviewed and send a local notification.
// Reason for this being a two-step process (a remote push notification followed by
// a local notification) is that we don't want to send VISIBLE notifications repeatedly
// to the user if user hasn't responded to last notification yet. So we check on 
// the device whether user has responded to the local notification and only present
// the notification again if it hasn't responded to the notification (the notification
// has been cleared by opening the app but user hasn't reviewed the user yet)
// Parse.Cloud.job("sendUserReviewNotifications", function (request, status) {
//     var usersMap = {};
//     var users = [];
//     var fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

//     var query = new Parse.Query("UserMatch");
//     query.doesNotExist("didMeet"); // value not set mean user hasn't responded to the review request
//     query.lessThanOrEqualTo("createdAt", fourHoursAgo);
//     query.include("fromUser");
//     query.include("toUser");

//     query.each(function(userMatch) {
//         console.log("userMatch: " + userMatch.id);
//         var fromUser = userMatch.get("fromUser");
//         var toUser = userMatch.get("toUser");
        
//         usersMap[fromUser.id] = fromUser;
//         usersMap[toUser.id] = toUser;
//     }).then(function() {
//         // get all the values in usersMap
//         for (var key in usersMap) {
//             if (usersMap.hasOwnProperty(key)) {
//                 var user = usersMap[key];
//                 if (user !== undefined) {
//                     users.push(user);                   
//                 }
//             }
//         }
//         console.log("number of users with unreviewed matches: " + users.length);
//         if (users.length > 0) {
//             var installQuery = new Parse.Query(Parse.Installation);
//             installQuery.containedIn("owner", users);

//             // send silent notifications to the devices which will trigger 
//             // the app to check which userMatch hasn't been reviewed and
//             // alert the user though local notifications
//             Parse.Push.send({
//                 where: installQuery,
//                 data: {
//                     type: "USER_REVIEW",
//                     sound: "",
//                     "content-available": 1 // NOTE: this is required to trigger a silent notification on iOS
//                 }
//             });
//         }
//     }).then(function () {
//         // Set the job's success status
//         status.success("sendUserReviewNotifications completed successfully.");
//     }, function (error) {
//         // Set the job's error status
//         status.error("sendUserReviewNotifications failed: " + JSON.stringify(error));
//     });
// });

// find the list of unreviewed UserMatch records for the given user 'forUser'
function findUnreviewedUserMatch(forUser) {
    var results = [];
    var fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    
    if (forUser === undefined) {
        return results;
    }

    var query = new Parse.Query(UserMatch);
    query.equalTo("fromUser", forUser);
    query.doesNotExist("didMeet"); // value not set mean user hasn't responded to the review request
    query.lessThanOrEqualTo("createdAt", fourHoursAgo);
    query.include("fromUser");
    query.include("toUser");
    
    return query.find().then(function(userMatches){
        results = userMatches.sort(function(a,b){return b.updatedAt.getTime() - a.updatedAt.getTime();});
        return results;
    });
}
                   
Parse.Cloud.beforeSave("Chat", function(request, response) {
	var chat = request.object;
    var fromUser = chat.get("lastMsgFromUser");
    if (chat.dirty("lastMsg") && (fromUser !== undefined)) {
        var users = chat.get("users");
        var otherUsers = users.filter(function(user){
            return user.id !== fromUser.id;
        });

        fromUser.fetch().then(function(fromUser){
            console.log("fetched user: ", fromUser.toJSON());
            var installQuery = new Parse.Query(Parse.Installation);
            installQuery.containedIn("owner", otherUsers);

            Parse.Push.send({
                where: installQuery, // Set our Installation query
                data: {
                    alert: fromUser.get("firstName") + ": " + chat.get("lastMsg"),
                    badge: "Increment",
                    type: "NEW_CHAT_MSG",
                    sound: "default",
                    chatId: chat.id
                }
            }, {
                success: function() {
                    // Push was successful
                    console.log("NEW_CHAT_MSG notification sent successfully.");
                    response.success();
                },
                error: function(error) {
                    // Handle error
                    console.error(error);
                    response.success(); // still save the record even if push failed as it's non-critical
                }
            });
        });
    } else {
        response.success();
    }
});

// Parse.Cloud.beforeSave(Parse.User, function(request, response) {
//     if (request.object.get("email") === "8yet@outlook.com") {
//         request.object.set("firstName", "8Yet Team");
//         request.object.set("lastName", "");
//     }
//     response.success();
// });

function sendMsgForChat(chat, fromUser, msg) {
    console.log("sendMsgToChat. chatId=" + chat.id + ", fromUser=" + fromUser.id + ", msg=" + msg);
    insertMsgToChat(chat, fromUser, msg);
    updateLastMsgForChat(chat, fromUser, msg);
    // update the unread chats count
    var users = chat.get("users");
    users.forEach(function(user) {
        if (user.id !== fromUser.id) {
            updateUnreadChatsCount(chat, user);
        }
    });
}

function updateLastMsgForChat(chat, fromUser, msg){
    console.log("updateLastMsgForChat. chatId=" + chat.id + ", fromUser=" + fromUser.id + ", msg=" + msg);
    chat.set("lastMsg", msg);
    chat.set("lastMsgFromUser", fromUser);
    chat.set("lastMsgTime", new Date());
    chat.save();
}

function insertMsgToChat(chat, fromUser, msg) {
    console.log("insertMsgToChat. chatId=" + chat.id + ", fromUser=" + fromUser.id + ", msg=" + msg);
    getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("firebaseUrl: " + firebaseUrl);

        Parse.Cloud.httpRequest({
            method: 'POST',
            url: firebaseUrl + "/messages/" + chat.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: {
                createdAt: (new Date()).getTime(),
                displayName: fromUser.get("firstName"),
                profileImgUrl: "https://graph.facebook.com/" + fromUser.get("facebookId") + "/picture?width=240&height=240",
                sender: fromUser.id,
                text: msg,
                type: "text"
            }
        }).then(function(httpResponse) {
            console.log("Send chat message success\n");
        }, function(httpResponse) {
            console.error('Send chat message failed. response code ' + httpResponse.status + ", body: " + httpResponse.text);
        });
    });
}

function insertFirebaseSystemMsgToChat(chat, params) {
    if (chat === undefined) {
        return;
    }
    
    console.log("insertSystemMsgToChat. chatId=" + chat.id + ", params=" + JSON.stringify(params));
    return getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("firebaseUrl: " + firebaseUrl);

        return Parse.Cloud.httpRequest({
            method: 'POST',
            url: firebaseUrl + "/messages/" + chat.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: {
                createdAt: (new Date()).getTime(),
                displayName: "8Yet?",
                profileImgUrl: "",
                sender: "",
                type: "system",
                data: params
            }
        }).then(function(httpResponse) {
            console.log("insertSystemMsgToChat success\n");
        }, function(httpResponse) {
            console.error('insertSystemMsgToChat failed. response code ' + httpResponse.status + ", body: " + httpResponse.text);
        });
    });
}

function updateUnreadChatsCount(chat, forUser) {
    console.log("update unread chats count. chatId=" + chat.id + ", forUser=" + forUser.id);
    return getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("firebaseUrl: " + firebaseUrl);
        
        Parse.Cloud.httpRequest({
            method: 'GET',
            url: firebaseUrl + "/users/" + forUser.id + "/unreadChats/" + chat.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
        }).then(function(httpResponse) {
            var respBody= httpResponse.text;
            console.log("get unreadChats count success\n " + respBody);
            var count = 0;
            if (respBody !== "null") {
                count = Number(respBody);
            }
            return count+1;
        }, function(httpResponse) {
            console.error('Firebase get unreadChat request failed. response code ' + httpResponse.status + ", body: " + httpResponse.text);
            return 0;
        }).then(function(count) {
            console.log("set unreadChats counter for userId=" + forUser.id + ", chatId=" + chat.id + ", count=" + count);
            Parse.Cloud.httpRequest({
                method: 'PUT',
                url: firebaseUrl + "/users/" + forUser.id + "/unreadChats/" + chat.id + ".json",
                params: {
                    auth: firebaseSecret
                },
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
                body: count.toString()
            }).then(function(httpResponse) {
                console.log("set unreadChats success\n " + httpResponse.text);
            }, function(httpResponse) {
                console.error('Firebase update unreadChat request failed. response code ' + httpResponse.status + ", body: " + httpResponse.text);
            });
        });
    });
}

function get8YetUser() {
    var userQuery = new Parse.Query(Parse.User);
    userQuery.equalTo("email", eightYetUserEmail);
    return userQuery.first({ useMasterKey: true });
}

function befriend8Yet(user) {
    var msg = "Hi, my name is Quan, founder of 8Yet. I may not be nearby to meet you for lunch. But my ears are all yours for feedback, bugs or anything in your life. P.S. Sometimes I may have a bot speaking on my behalf, when I'm busy banging out code. :)";
    if (user === undefined) {
        return;
    }
    // be-friend 8Yet team for the new user
    console.log("add 8Yet user to chat for user: " + user.id);
    get8YetUser().then(function(eightYetUser){
        console.log("found 8Yet user");
        upSertChat([user, eightYetUser]).then(function(chat){
            console.log("upSertChat done with new user. userId=" + user.id + ", chatId=" + chat.id);
            sendMsgForChat(chat, eightYetUser, msg);
        });
    }, function(error) {
        console.error("failed to find 8Yet user: " + JSON.stringify(error));
    });
}

// find the private chat with 8Yet
Parse.Cloud.define("findChatWith8Yet", function(request, response) {
    var user = request.user;
    if (user === undefined) {
        return response.error("Invalid parameter. missing user");
    }
    return get8YetUser().then(function(eightYetUser) {
        if (eightYetUser === undefined) {
            return response.error("8Yet user not found");
        }
        
        var chatQuery = new Parse.Query("Chat");
        chatQuery.containsAll("users", [user, eightYetUser]);
        chatQuery.include("users");
        chatQuery.limit(1000);
        return chatQuery.find().then(function(chats) {
            var results = chats.filter(function(chat) {
                return chat.get("users").length === 2;
            });
            return response.success(results);
        }, function(error){
           response.error("Error in findChatWith8Yet: " + error.message);
        });
    });
});

// this is an error recovering job that adds the 8Yet user as a contact in case it wasn't created successfully when the new user was created
// Parse.Cloud.job("befriend8Yet", function(request, status) {
//     console.log("Add 8Yet Team as a contact to each user who hasn't befriended 8Yet");
    
//     get8YetUser().then(function(eightYetUser) {
//         if (eightYetUser === undefined) {
//             return Parse.Promise.error("8Yet user not found");
//         }
//         console.log("found 8yet user");
//         var userQuery = new Parse.Query(Parse.User);
//         return userQuery.each(function(user){
//             if (user.id === eightYetUser.id) {
//                 return;
//             }
//             console.log("Befriend 8Yet, checking user: " + user.id + ", " + user.get("name"));
//             var chatQuery = new Parse.Query("Chat");
//             chatQuery.containsAll("users", [user, eightYetUser]);
//             return chatQuery.find().then(function(results) {
//                 console.log("result: " + results);
//                 if (results.length === 0) {
//                     return befriend8Yet(user);
//                 }
//             }, function(error) {
//                 console.error("Error on chatQuery with users: [" + user.id + ", " + eightYetUser.id + "]: " + JSON.stringify(error));
//             });
//         });
//     }).then(function(){
//         status.success("befriend8Yet Job finished");
//     }, function(error){
//         console.error("befriend8Yet Job failed: " + JSON.stringify(error));
//         status.error(JSON.stringify(error));
//     });
// });

Parse.Cloud.afterSave(Parse.User, function(request) {
    var user = request.object;
    
    console.log("user: " + user.id + " isNew: " + user.isNew() + ", existed: " + user.existed());

    if (!user.existed()) { // newly created user
        befriend8Yet(user);
    }
});

Parse.Cloud.afterSave("Plan", function(request) {
   var plan = request.object;
   var user = request.user;
   
   console.log("saving plan: " + plan.id + ", existed: " + plan.existed());
   if (!plan.existed()) {
       // new plan
       var numCalled = user.get("numPlansCalled")? user.get("numPlansCalled") + 1 : 1;
       user.set("numPlansCalled", numCalled);
       console.log("num called: " + numCalled);
       user.save(null, { sessionToken: user.getSessionToken() });
       firebaseCreatePlan(plan);
   } else {
       firebaseUpdatePlan(plan);
   }
});

Parse.Cloud.define("joinPlan", function(request, response) {
    console.log("### joingPlan. request=" + JSON.stringify(request));
    var user = request.user;
    var planId = request.params.planId;
    
    if (planId === undefined || user === undefined) {
        return response.error("joinPlan: invalid parameter.");
    }
    
    console.log("joinPlan. userId=" + user.id + ", planId=" + planId);
    
    var query = new Parse.Query(Plan);
    
    return query.get(planId).then(function (plan) {
        if (alreadyInPlan(user, plan) === false) {
            console.log("adding user to participants. userId=" + user.id + ", planId=" + plan.id);
            var participants = plan.get("participants");
            participants.push(user);
            plan.set("numParticipants", participants.length);
            var chat = plan.get("chat");
            if (chat === undefined && participants.length >= 2) {
                var chat = new Chat();
                plan.set("chat", chat);
            }
            chat.set("users", participants);
            var numJoined = user.get("numPlansJoined")? user.get("numPlansJoined") + 1 : 1;
            request.user.set("numPlansJoined", numJoined);
console.log("### attempt 1 sessionToken: " + request.user.getSessionToken());
            var p1 = plan.save();
            var p2 = request.user.save(null,  {sessionToken: request.user.getSessionToken()});
            return Parse.Promise.when([p1, p2]).then(function(savedPlan) {
                console.log("joinPlan plan and user saved successfully");
                	// send out notifications to other users in the plan
                    // also update firebase records to notify apps that the plan has changed
                    var otherUsers = participants.filter(function(participant) {return participant.id !== user.id;});
					var installQuery = new Parse.Query(Parse.Installation);
					console.log("installQuery owners: [" + otherUsers.map(function(user){return user.id;}).join() + "]");
					installQuery.containedIn("owner", otherUsers);
                    
                    var p1 = Parse.Push.send({
						where: installQuery, // Set our Installation query
						data: {
							alert: user.get("firstName") + " has joined your plan!",
							badge: "Increment",
							type: "JOIN_PLAN",
                            sound: "default"
						}
					});
                    var p2 = firebaseUpdatePlan(plan);
                    
                    var params = {
                        sysMsgType: "join_plan",
                        fromUserId: user.id,
                        fromUserName: user.get("firstName")
                    };
                    var p3 = insertFirebaseSystemMsgToChat(plan.get("chat"), params);
                    
                    return Parse.Promise.when([p1, p2, p3]).then(function() {
                        // Push was successful
                        console.log("joinPlan finished successfully");
                        return response.success(plan);
                    }, function(error) {
                        // Handle error
                        console.error("joinPlan finished with error: " + error.message);
                        // return success even if the notification failed to be sent or firebase update failed as they are not fatal errors
                        return response.success(plan);
                    });
            }, function(error) {
                var msg = "Failed to join plan. userId=" + user.id + ", planId=" + planId + ", error=" + JSON.stringify(error);
                console.error(msg);
                return response.error(msg);
            });
        } else {
            console.log("User already in plan. userId=" + user.id + ", planId=" + planId);
            return response.success(plan);
        }
    }, function(error) {
        var msg = "Failed to join plan. userId=" + user.id + ", planId=" + planId + ", error=" + JSON.stringify(error);
        console.error(msg);
        return response.error(msg);
    });
});

function alreadyInPlan(user, plan) {
    if (plan.get("host").id === user.id) {
        return true;
    } else {
        var participants = plan.get("participants");
        var filteredList = participants.filter(function(participant) { return participant.id === user.id; });
        return filteredList.length > 0;
    }
}

Parse.Cloud.define("quitPlan", function(request, response) {
    var user = request.user;
    var planId = request.params.planId;
    var msg;
    
    if (planId === undefined || user === undefined) {
        return response.error("quitPlan: invalid parameter.");
    }
    
    console.log("quitPlan. userId=" + user.id + ", planId=" + planId);
    
    var query = new Parse.Query(Plan);
    return query.get(planId).then(function (plan) {
        var host = plan.get("host");
        var participants = plan.get("participants");
         
        if (host !== undefined && host.id === user.id) { // host cancelling his own plan
            console.log("Host cancelling plan. hostId=" + host.id + ", planId=" + planId);
            if (plan.get("numParticipants") > 1) {
                msg = "Can't cancel a plan for which people have already joined. userId=" + user.id + ", planId=" + planId;
                console.error(msg);
                return response.error("Can't cancel a plan for which people have already joined.");
            } else {
                var numCalled = user.get("numPlansCalled")? user.get("numPlansCalled") - 1 : 0;
                if (numCalled < 0) {
                    numCalled = 0;
                }
                user.set("numPlansCalled", numCalled);
                return Parse.Promise.when([plan.destroy(), user.save(null, { sessionToken: user.getSessionToken() })]).then(function(deletedPlan){
                    console.log("quitPlan, delete plan success. userId=" + user.id + ", planId=" + planId);
                    return firebaseDeletePlan(plan).then(function() {
                        console.log("firebase plan deleted successfully");
                        return response.success(deletedPlan);
                    }, function(error) {
                        console.error("firebase plan delete failed: " + error.message);
                        return response.success(deletedPlan); // return success in the case of failure as well
                    })
                }, function(object, error){
                    msg = "quitPlan. failed to delete plan. userId=" + user.id + ", planId=" + planId + ", error: " + error.message;
                    console.error(msg);
                    return response.error(msg);
                });
            }
        } else {
            if (participants !== undefined) {
                console.log("Participants before quitting plan: " + participants.map(function(participant){return participant.id;}).join(","));
                var newParticipants = participants.filter(function(participant) {return participant.id !== user.id;});
                if (newParticipants.length === participants.length) {
                    msg = "Error quitting plan. User is not in participants list. userId=" + user.id + ", planId=" + plan.id;
                    console.error(msg);
                    return response.error(msg);
                } else {
                    plan.set("participants", newParticipants);
                    plan.set("numParticipants", newParticipants.length);
                    var chat = plan.get("chat");
                    if (chat !== undefined) {
                        chat.set("users", newParticipants);
                    }
                    var numJoined = user.get("numPlansJoined")? user.get("numPlansJoined") - 1 : 0;
                    if (numJoined < 0) {
                        numJoined = 0;
                    }
                    user.set("numPlansJoined", numJoined);
                    return Parse.Promise.when([plan.save(), user.save(null, { sessionToken: user.getSessionToken() })]).then(function(savedPlan){
                        // send out notifications to other users in the plan
                        var installQuery = new Parse.Query(Parse.Installation);
                        console.log("installQuery owners: [" + newParticipants.map(function(user){return user.id;}).join() + "]");
                        installQuery.containedIn("owner", newParticipants);

                        var p1 =  Parse.Push.send({
                            where: installQuery, // Set our Installation query
                            data: {
                                alert: user.get("firstName") + " has left your plan :(",
                                badge: "Increment",
                                type: "QUIT_PLAN",
                                sound: "default"
                            }
                        });
                        var p2 = firebaseUpdatePlan(plan);
                        
                        var params = {
                            sysMsgType: "quit_plan",
                            fromUserId: user.id,
                            fromUserName: user.get("firstName")
                        };
                        var p3 = insertFirebaseSystemMsgToChat(plan.get("chat"), params);
                        
                        return Parse.Promise.when([p1, p2, p3]).then(function() {
                            // Push was successful
                            console.log("quitPlan finished successfully");
                            return response.success(plan);
                        }, function(error) {
                            // Handle error
                            console.error("quitPlan finished with error: " + error.message);
                            // return success even if the notification failed to be sent or firebase update failed as they are not fatal errors
                            return response.success(plan);
                        });
                    }, function(error) {
                        var msg = "Failed to quit plan. userId=" + user.id + ", planId=" + planId + ", error=" + error.message;
                        console.error(msg);
                        return response.error(msg);
                    });
                }
            } else {
                msg = "Error quitting plan. Plan has no participants. userId=" + user.id + ", planId=" + plan.id;
                console.error(msg);
                return response.error(msg);
            }
        }
    }, function(error) {
        var msg = "Failed to quit plan. userId=" + user.id + ", planId=" + planId + ", error=" + error.message;
        console.error(msg);
        return response.error(msg);
    });
});

// update the numMeets, numBails, totalRatingScore, etc in the user object accordingly
Parse.Cloud.beforeSave("UserMatch", function(request, response) {
    var user = request.user;
    var userMatch = request.object;
    if (userMatch.isNew()) {
        console.log("new UserMatching, nothing to be updated");
        response.success(); // nothing to be done when it's newly created
    } else {
        var query = new Parse.Query("UserMatch");
        query.get(userMatch.id, {
            success: function(oldObj) {
                if ((oldObj.get("didMeet") === undefined) && (userMatch.get("didMeet") !== undefined)) {
                    var didMeet = userMatch.get("didMeet");
                    if  (didMeet === true) {
                        if ((oldObj.get("ratingsOfToUser") === undefined) && (userMatch.get("ratingsOfToUser") !== undefined)) {
                            var rating = userMatch.get("ratingsOfToUser");
                            var userQuery = new Parse.Query(Parse.User);
                            userQuery.get(userMatch.get("toUser").id, {
                                success: function(toUser){
                                    var numMeets = toUser.get("numMeets") ? toUser.get("numMeets") : 0;
                                    numMeets++;
                                    toUser.set("numMeets", numMeets);
                                    var numRatings = toUser.get("numRatings") ? toUser.get("numRatings") : 0;
                                    numRatings++;
                                    toUser.set("numRatings", numRatings);
                                    var totalRatingScore = toUser.get("totalRatingScore") ? toUser.get("totalRatingScore") : 0;
                                    totalRatingScore += rating;
                                    toUser.set("totalRatingScore", totalRatingScore);
                                    Parse.Promise.when([user.save(null, { useMasterKey: true}), toUser.save(null, { useMasterKey: true })]).then(
                                        function(){
                                            response.success();
                                        }, function(error){
                                            response.error(error);
                                        }
                                    );
                                },
                                error: function(error) {
                                    console.error("Failed to query for toUser: " + JSON.stringify(error));
                                    response.error(error);
                                }
                            });
                        } else {
                            user.save(null, { useMasterKey: true}).then(
                                function(obj){
                                    response.success();
                                }, function(error){
                                    console.error("Error saving user in beforeSave for UserMatch: " + JSON.stringify(error));
                                    response.error(error);
                                }
                            );

                        }
                    } else if (didMeet === false) {
                        var bailOutReason = userMatch.get("bailOutReason");
                        if ((oldObj.get("bailOutReason") === undefined) && (bailOutReason === "didNotArrange" || bailOutReason === "didNotGo")){
                            var numBails = user.get("numBails") ? user.get("numBails") : 0;
                            numBails++;
                            user.set("numBails", numBails);
                        }

                        user.save(null, { useMasterKey: true}).then(
                            function(obj){
                                response.success();
                            }, function(error){
                                console.error("Error saving user in beforeSave for UserMatch: " + JSON.stringify(error));
                                response.error(error);
                            }
                        );
                    }
                } else {
                    response.success();
                }
            },
            error: function(obj, error) {
                response.error(error.message);
            }
        });
    }
});

function insertFirebaseUserMatch(userMatch) {
    if (userMatch === undefined) {
        console.error("userMatch not defined");
        return;
    }
    var fromUser = userMatch.get("fromUser");
    if (fromUser === undefined) {
        console.error("fromUser not defined in UserMatch with id=" + userMatch.id);
    }
    console.log("Insert firebase userMatch: " + userMatch.id);
    getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("Sending firebase insert userMatch request");
        Parse.Cloud.httpRequest({
            method: 'PUT',
            url: firebaseUrl + "/users/" + fromUser.id + "/userMatch/" + userMatch.id + "/createdAt.json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: {".sv": "timestamp"}
        }).then(function(httpResponse) {
            console.log("insertFirebaseUserMatch response: " + httpResponse.text);
            return Parse.Promise.as();
        }, function(httpResponse) {
            console.error('Firebase update userMatch request failed with response code ' + httpResponse.status + ", body: " + httpResponse.text);
            return Parse.Promise.error(httpResponse.text);
        });
    });
}

function firebaseCreatePlan(plan) {
    if (plan === undefined) {
        console.error("plan not defined");
        return Parse.Promise.as();
    }

    console.log("firebase create plan, id=" + plan.id);
    return getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("Sending firebase plan create request");
        Parse.Cloud.httpRequest({
            method: 'PUT',
            url: firebaseUrl + "/plans/" + plan.id + "/createdAt.json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: {".sv": "timestamp"}
        }).then(function(httpResponse) {
            console.log("firebaseCreatePlan response: " + httpResponse.text);
            return Parse.Promise.as();
        }, function(httpResponse) {
            console.error('firebaseCreatePlan request failed with response code ' + httpResponse.status + ", body: " + httpResponse.text);
            return Parse.Promise.error(httpResponse.text);
        });
    });
}


function firebaseUpdatePlan(plan) {
    if (plan === undefined) {
        console.error("plan not defined");
        return Parse.Promise.as();
    }

    console.log("firebase update plan, id=" + plan.id);
    return getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("Sending firebase plan update request");
        Parse.Cloud.httpRequest({
            method: 'PUT',
            url: firebaseUrl + "/plans/" + plan.id + "/updatedAt.json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
            body: {".sv": "timestamp"}
        }).then(function(httpResponse) {
            console.log("firebaseUpdatePlan response: " + httpResponse.text);
            return Parse.Promise.as();
        }, function(httpResponse) {
            console.error('firebaseUpdatePlan request failed with response code ' + httpResponse.status + ", body: " + httpResponse.text);
            return Parse.Promise.error(httpResponse.text);
        });
    });
}

function firebaseDeletePlan(plan) {
    if (plan === undefined) {
        console.error("plan not defined");
        return Parse.Promise.as();
    }

    console.log("firebase delete plan, id=" + plan.id);
    return getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        console.log("Sending firebase plan delete request");
        Parse.Cloud.httpRequest({
            method: 'DELETE',
            url: firebaseUrl + "/plans/" + plan.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            }
        }).then(function(httpResponse) {
            console.log("firebaseDeletePlan response: " + httpResponse.text);
        }, function(httpResponse) {
            console.error('firebaseDeletePlan request failed with response code ' + httpResponse.status + ", body: " + httpResponse.text);
        });
    });
}

// this is called when user turns on demo mode on the device. 
// it will delete all Chats, Contacts, UserMatches and Swipes between the login user and all test users in the system
// so that the demo can proceed like it's freshly installed.
Parse.Cloud.define("cleanTestUserData", function(request, response) {
    var user = request.user;
    console.log("cleanTestUserData for user: " + user.id);
    
    getTestUsers().then(function(testUsers){
        var testUserIds = [];
        if (testUsers !== undefined) {
            testUserIds = testUsers.map(function(testUser){return testUser.id;});
        }
        console.log("clean test user data for user: " + user.id + ", testUsers: " + JSON.stringify(testUserIds));
        var p1 = cleanChats(user, testUsers);
        var p2 = cleanContacts(user, testUsers);
        var p3 = cleanUserMatches(user, testUsers);
        var p4 = cleanSwipes(user, testUsers);
        return Parse.Promise.when([p1, p2, p3, p4]);
    }).then(function(r1, r2, r3, r4){
        return response.success();
    }, function(error){
        return response.error("Error on cleanTestUserData: " + error.message);
    });
});

// change all test users' location to the login user's location
// so that they can appear nearby
Parse.Cloud.define("setTestUserLocations", function(request, response) {
    var user = request.user;
    console.log("setTestUserLocations");
    
    var userLocation = user.get("lastKnownLocation");
    if (userLocation !== undefined) {
        var promises = [];
        getTestUsers().then(function(testUsers){
            if (testUsers !== undefined) {
                testUsers.forEach(function(testUser) {
                    console.log("setTestUserLocation for userId=" + testUser.id + " : " + JSON.stringify(userLocation));
                    testUser.set("lastKnownLocation", userLocation);
                    promises.push(testUser.save(null, { useMasterKey: true }));
                });
            }
            return Parse.Promise.when(promises);
        }).then(function(){
            console.log("setTestUserLocation success");
            return response.success();
        }, function(error) {
            console.error("setTestUserLocation failed: " + error.message);
            return response.error("Error in setTestUserLocations: " + error.message);
        });
    } else {
        console.error("Error in setTestUserLocations. User location unavailable");
        return response.error("Error in setTestUserLocations. User location unavailable");
    }
});

function getTestUsers() {
    console.log("Get test users");
    var query = new Parse.Query(Parse.User);
    query.containedIn("email", testUserEmails);
    return query.find();
}

function cleanChats(user, testUsers) {
    console.log("cleanChats for user: " + user.id);
    var promises = [];
    testUsers.forEach(function(testUser){
        if (user.id === testUser.id) { // skip if the user is the same as test user
            return;
        }
        var query = new Parse.Query("Chat");
        query.containsAll("users", [user, testUser]);
        promises.push(query.find().then(function(chats){
            var chatIds = chats.map(function(chat) {return chat.id;});
            console.log("delete chats with id: " + JSON.stringify(chatIds) + " for users: " + user.id + ", " + testUser.id);
            chats.forEach(function(chat) { deleteFirebaseChat(chat);});
            return Parse.Object.destroyAll(chats);
        }));
    });
    return Parse.Promise.when(promises);
}

function cleanContacts(user, testUsers) {
    console.log("cleanContacts for user: " + user.id);
    var promises = [];
    testUsers.forEach(function(testUser){
        if (user.id === testUser.id) { // skip if the user is the same as test user
            return;
        }
        var subQuery1 = new Parse.Query("Contact");
        subQuery1.equalTo("owner", user);
        subQuery1.equalTo("user", testUser);
        
        var subQuery2 = new Parse.Query("Contact");
        subQuery2.equalTo("owner", testUser);
        subQuery2.equalTo("user", user);
        
        var mainQuery = Parse.Query.or(subQuery1, subQuery2);

        promises.push(mainQuery.find().then(function(contacts){
            var contactIds = contacts.map(function(contact) { return contact.id;});
            console.log("delete contacts with id: " + JSON.stringify(contactIds));
            return Parse.Object.destroyAll(contacts);
        }));
    });
    return Parse.Promise.when(promises);
}

function cleanUserMatches(user, testUsers) {
    console.log("cleanUserMatches for user: " + user.id);
    var promises = [];
    testUsers.forEach(function(testUser){
        if (user.id === testUser.id) { // skip if the user is the same as test user
            return;
        }
        var subQuery1 = new Parse.Query("UserMatch");
        subQuery1.equalTo("fromUser", user);
        subQuery1.equalTo("toUser", testUser);
        
        var subQuery2 = new Parse.Query("UserMatch");
        subQuery2.equalTo("fromUser", testUser);
        subQuery2.equalTo("toUser", user);
        
        var mainQuery = Parse.Query.or(subQuery1, subQuery2);

        promises.push(mainQuery.find().then(function(userMatches){
            var userMatchIds = userMatches.map(function(userMatch) { return userMatch.id;});
            console.log("delete userMatches with id: " + JSON.stringify(userMatchIds));
            userMatches.forEach(function(userMatch) { deleteFirebaseUserMatch(userMatch);});
            return Parse.Object.destroyAll(userMatches);
        }));
    });
    return Parse.Promise.when(promises);
}

function cleanSwipes(user, testUsers) {
    console.log("cleanSwipes for user: " + user.id);
    var promises = [];
    testUsers.forEach(function(testUser){
        if (user.id === testUser.id) { // skip if the user is the same as test user
            return;
        }
        var subQuery1 = new Parse.Query("Swipe");
        subQuery1.equalTo("fromUser", user);
        subQuery1.equalTo("toUser", testUser);
        subQuery1.limit(1000);
        
        var subQuery2 = new Parse.Query("Swipe");
        subQuery2.equalTo("fromUser", testUser);
        subQuery2.equalTo("toUser", user);
        subQuery2.limit(1000);
        
        var mainQuery = Parse.Query.or(subQuery1, subQuery2);

        promises.push(mainQuery.find().then(function(swipes){
            var swipeIds = swipes.map(function(swipe) { return swipe.id;});
            console.log("delete swipes with id: " + JSON.stringify(swipeIds));
            return Parse.Object.destroyAll(swipes);
        }));
    });
    return Parse.Promise.when(promises);
}

function deleteFirebaseChat(chat) {
    console.log("delete firebase chat: " + chat.id);
    getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");

        Parse.Cloud.httpRequest({
            method: 'DELETE',
            url: firebaseUrl + "/messages/" + chat.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
        }).then(function(httpResponse) {
            console.log(httpResponse.text);
        }, function(httpResponse) {
            console.error('Firebase delete chat for id ' + chat.id + ' failed with response code ' + httpResponse.status + ', body: ' + httpResponse.text);
        });
        
        var users = chat.get("users");
        users.forEach(function(user){
            console.log("delete firebase unread chat for user: " + user.id + ", chat id: " + chat.id);
            Parse.Cloud.httpRequest({
                method: 'DELETE',
                url: firebaseUrl + "/users/" + user.id + "/unreadChats/" + chat.id + ".json",
                params: {
                    auth: firebaseSecret
                },
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                },
            }).then(function(httpResponse) {
                console.log(httpResponse.text);
            }, function(httpResponse) {
                console.error('Firebase delete unread chat for id ' + chat.id + ', user: ' + user.id + ' failed with response code ' + httpResponse.status + ', body: ' + httpResponse.text);
            });            
        });
    });
}

function deleteFirebaseUserMatch(userMatch) {
    console.log("delete firebase userMatch: " + userMatch.id);
    getParseConfig().then(function(config) {
        var firebaseUrl = config.get("firebaseUrl");
        var firebaseSecret = config.get("firebaseSecret");
        var fromUser = userMatch.get("fromUser");
        
        Parse.Cloud.httpRequest({
            method: 'DELETE',
            url: firebaseUrl + "/users/" + fromUser.id + "/userMatch/" + userMatch.id + ".json",
            params: {
                auth: firebaseSecret
            },
            headers: {
                'Content-Type': 'application/json;charset=utf-8'
            },
        }).then(function(httpResponse) {
            console.log(httpResponse.text);
        }, function(httpResponse) {
            console.error('Firebase delete userMatch for id ' + userMatch.id + ' failed with response code ' + httpResponse.status + ', body: ' + httpResponse.text);
        });
    });
}

// clean up the "Location" object belonging to the plan being deleted
Parse.Cloud.afterDelete("Plan", function(request) {
    var plan = request.object;
    var location = plan.get("location");
    location.destroy().then(function() {
        console.log("Location for planId=" + plan.id + " was deleted successfully");
    }, function(error){
        console.error("Failed to delete the location object for planId=" + plan.id + ", error: " + error.message);
    });
    
    var chat = plan.get("chat")
    if (chat != undefined) {
        console.log("deleting chat for planId=" + plan.id + ", chatId=" + chat.id);
        chat.destroy().then(function(){
            deleteFirebaseChat(chat)
            console.log("Chat for planId=" + plan.id + " was deleted successfully");
        }, function(error) {
            console.error("Failed to delete chat for planId=" + plan.id + ", chatId=" + chat.id + ", error: " + error.message);
        })
    }
});