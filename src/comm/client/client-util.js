/**
* Copyright 2017 HUAWEI. All Rights Reserved.
*
* SPDX-License-Identifier: Apache-2.0
*
*/


'use strict'

const CLIENT_LOCAL = 'local';
const CLIENT_ZOO   = 'zookeeper';

var zkUtil     = require('./zoo-util.js');
var processes  = {}; // {pid:{obj, promise}}

function setPromise(pid, isResolve, msg) {
    var p = processes[pid];
    if(p && p.promise && typeof p.promise !== 'undefined') {
        if(isResolve) {
            p.promise.resolve(msg);
        }
        else {
            p.promise.reject(msg);
        }
    }
}

function pushResult(pid, data) {
    var p = processes[pid];
    if(p && p.results && typeof p.results !== 'undefined') {
        p.results.push(data);
    }
}

function queryCallback(pid, session, data) {
    var p = processes[pid];
    if(p && p.queryCB && typeof p.queryCB !== 'undefined') {
        p.queryCB(session, data);
    }
}

function launchClient(message, queryCB, results) {
    var path = require('path');
    var childProcess = require('child_process');
    var child = childProcess.fork(path.join(__dirname, 'local-client.js'));
    var pid   = child.pid.toString();
    processes[pid] = {obj: child, results: results, queryCB: queryCB};

    child.on('message', function(msg) {
        if(msg.type === 'testResult') {
            pushResult(pid, msg.data);
            setPromise(pid, true, null);
        }
        else if(msg.type === 'error') {
            setPromise(pid, false, new Error('Client encountered error:' + msg.data));
        }
        else if(msg.type === 'queryResult') {
            queryCallback(pid, msg.session, msg.data);
        }
    });

    child.on('error', function(){
        setPromise(pid, false, new Error('Client encountered unexpected error'));
    });

    child.on('exit', function(){
        console.log('Client exited');
        setPromise(pid, true, null);
    });
}

function startTest(number, message, queryCB, results) {
    var count = 0;
    for (var i in processes) {
        count++;
    }
    if(count === number) {  // already launched clients
        let txPerClient  = Math.floor(message.numb / number);
        let tpsPerClient = Math.floor(message.tps / number);
        if(txPerClient < 1) {
            txPerClient = 1;
        }
        if(tpsPerClient < 1) {
            tpsPerClient = 1;
        }
        message.numb = txPerClient;
        message.tps  = tpsPerClient;

        let promises = [];
        for(let id in processes) {
            let client = processes[id];
            let p = new Promise((resolve, reject) => {
                client['promise'] = {
                    resolve: resolve,
                    reject:  reject
                }
            });
            promises.push(p);
            client['results'] = results;
            client['queryCB'] = queryCB;
            client.obj.send(message);
        }

        return Promise.all(promises)
                .then(()=>{
                    // clear promises
                    for(let client in processes) {
                        delete client.promise;
                    }
                    return Promise.resolve();
                })
                .catch((err)=>{
                    return Promise.reject(err);
                });

    }

    // launch clients
    processes = {};
    for(let i = 0 ; i < number ; i++) {
        launchClient(message, queryCB, results);
    }

    // start test
    return startTest(number, message, queryCB, results);
}
module.exports.startTest = startTest;

function sendMessage(message) {
    for(let pid in processes) {
        processes[pid].obj.send(message);
    }
    return processes.length;
}
module.exports.sendMessage = sendMessage;

function stop() {
    for(let pid in processes) {
        processes[pid].obj.kill();
    }
    processes = {};
}
module.exports.stop = stop;