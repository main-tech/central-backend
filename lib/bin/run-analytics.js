// Copyright 2021 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/getodk/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.
//
// This script checks if enough time has passed since the last time
// analytics were submitted, and if so, prepares a report, converts it to
// XML, submits it to data.getodk.cloud, and logs the action in the audit log.

const { run } = require('../task/task');
const { runAnalytics } = require('../task/analytics');

const { program } = require('commander');
program.option('-f', 'Force analytics to be sent (if configured) even if not scheduled yet.');
program.parse();

const options = program.opts();

run(runAnalytics(options.force));
