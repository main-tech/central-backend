// This file exports an enketo mock for testing. A test can communicate with the
// mock by getting or setting properties of global.enketo.

const appRoot = require('app-root-path');
const { call } = require('ramda');
const Problem = require(appRoot + '/lib/util/problem');
const { without } = require(appRoot + '/lib/util/util');

const defaults = {
  // Properties that each test can set to determine the behavior of the mock

  // If `state` is set to 'error', the mock will pretend that Enketo has
  // misbehaved and will return a rejected promise for the next call.
  state: undefined,
  // Controls the timing of the Enketo response.
  wait: call,
  // The enketoId for the create() or createOnceToken() method to return. By
  // default, it is ::abcdefgh for create() and ::::abcdefgh for
  // createOnceToken().
  token: undefined,

  // Properties that the mock may update after being called. These properties
  // are how the mock communicates back to the test.

  // The total number of times that the mock has been called during the test
  callCount: 0,
  // The OpenRosa URL that was passed to the create() or createOnceToken()
  // method
  receivedUrl: undefined,
  // An object with a property for each argument passed to the edit() method
  editData: undefined
};

let cancelToken = 0;

const reset = () => {
  if (global.enketo === undefined) global.enketo = {};
  Object.assign(global.enketo, defaults);
  cancelToken += 1;
};

// Mocks a request to Enketo.
const request = (f) => {
  global.enketo.callCount += 1;
  const options = { ...global.enketo };
  Object.assign(global.enketo, without(['callCount'], defaults));
  return new Promise((resolve, reject) => {
    const { wait } = options;
    const tokenBeforeWait = cancelToken;
    wait(() => {
      if (cancelToken !== tokenBeforeWait)
        reject(new Error('request was canceled'));
      else if (options.state === 'error')
        reject(Problem.internal.enketoUnexpectedResponse('wrong status code'));
      else
        resolve(f(options));
    });
  });
};

const _create = (prefix) => (openRosaUrl) =>
  request(({ token = `${prefix}abcdefgh` }) => {
    global.enketo.receivedUrl = openRosaUrl;
    return token;
  });

const edit = (openRosaUrl, domain, form, logicalId, submissionDef, attachments, token) =>
  request(() => {
    global.enketo.editData = { openRosaUrl, domain, form, logicalId, submissionDef, attachments, token };
    return 'https://enketo/edit/url';
  });

module.exports = {
  create: _create('::'), createOnceToken: _create('::::'), edit,
  reset
};

