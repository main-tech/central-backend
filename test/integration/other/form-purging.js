const { createReadStream, readFileSync } = require('fs');
const appPath = require('app-root-path');
const { sql } = require('slonik');
const { testService } = require('../setup');
const testData = require('../../data/xml');
// eslint-disable-next-line import/no-dynamic-require
const { exhaust } = require(appPath + '/lib/worker/worker');


describe('query module form purge', () => {
  it('should purge a form deleted over 30 days ago', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => container.run(sql`update forms set "deletedAt" = '1999-1-1' where id = 1`))
        .then(() => container.Forms.purge()) // default purge() targets forms deleted > 30 days ago
        .then(() => Promise.all([
          container.oneFirst(sql`select count(*) from forms where id = 1`),
          container.oneFirst(sql`select count(*) from form_defs where "formId" = 1`)
        ])
          .then((counts) => {
            counts.should.eql([ 0, 0 ]);
          })))));

  it('should purge multiple forms deleted over 30 days ago', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.simple2)
        .set('Content-Type', 'application/xml')
        .then(() => asAlice.delete('/v1/projects/1/forms/simple'))
        .then(() => asAlice.delete('/v1/projects/1/forms/simple2'))
        .then(() => asAlice.delete('/v1/projects/1/forms/withrepeat'))
        .then(() => container.run(sql`update forms set "deletedAt" = '1999-1-1' where "xmlFormId" in ('simple', 'simple2')`))
        .then(() => container.Forms.purge())
        .then((purgeCount) => purgeCount.should.equal(2)))));

  it('should by default not purge a recently deleted form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => container.Forms.purge())
        .then(() => Promise.all([
          container.oneFirst(sql`select count(*) from forms where id = 1`),
          container.oneFirst(sql`select count(*) from form_defs where "formId" = 1`)
        ])
          .then((counts) => {
            counts.should.eql([ 1, 1 ]);
          })))));

  it('should purge a recently deleted form immediately when forced', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => Promise.all([
          container.oneFirst(sql`select count(*) from forms where id = 1`),
          container.oneFirst(sql`select count(*) from form_defs where "formId" = 1`)
        ])
          .then((counts) => {
            counts.should.eql([ 0, 0 ]);
          })))));

  it('should purge a deleted form by ID', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.delete('/v1/projects/1/forms/simple')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms')
          .send(testData.forms.withAttachments)
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => container.Forms.getByProjectAndXmlFormId(1, 'withAttachments').then((o) => o.get()))
        .then((ghostForm) => asAlice.delete('/v1/projects/1/withAttachments')
          .then(() => container.Forms.purge(true, 1)) // force delete a single form
          .then(() => Promise.all([
            container.oneFirst(sql`select count(*) from forms where id = ${ghostForm.id}`),
            container.oneFirst(sql`select count(*) from forms where id = 1`), // deleted form id
          ])
            .then((counts) => {
              counts.should.eql([ 1, 0 ]);
            }))))));

  it('should log the purge action in the audit log', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()) // get the form before we delete it
        .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
          .then(() => container.Audits.getLatestByAction('form.purge'))
          .then((audit) => {
            audit.isDefined().should.equal(true);
            audit.get().acteeId.should.equal(form.acteeId);
          })))));

  it('should update the actee table with purgedAt details', testService((service, container) =>
    service.login('alice', (asAlice) =>
      container.Forms.getByProjectAndXmlFormId(1, 'simple').then((o) => o.get()) // get the form before we delete it
        .then((form) => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200)
          .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
          .then(() => container.one(sql`select * from actees where id = ${form.acteeId}`))
          .then((res) => {
            res.details.projectId.should.equal(1);
            res.details.formId.should.equal(1);
            res.details.version.should.equal('');
            res.details.xmlFormId.should.equal('simple');
            res.details.deletedAt.should.be.an.isoDate();
            res.purgedName.should.equal('Simple');
          })))));

  it('should purge a form with multiple versions', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/draft')
        .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200))
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => Promise.all([
          container.oneFirst(sql`select count(*) from forms where id = 1`),
          container.oneFirst(sql`select count(*) from form_defs where "formId" = 1`)
        ]))
        .then((counts) => counts.should.eql([ 0, 0 ])))));

  it('should purge attachments (and blobs) of a form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms')
        .send(testData.forms.withAttachments)
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/attachments/goodone.csv')
          .send('this is goodone.csv')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/withAttachments/draft/publish')
          .expect(200))
        .then(() => container.Forms.getByProjectAndXmlFormId(1, 'withAttachments').then((o) => o.get()))
        .then((ghostForm) => asAlice.delete('/v1/projects/1/forms/withAttachments')
          .expect(200)
          .then(() => container.Forms.purge(true))
          .then(() => Promise.all([
            container.oneFirst(sql`select count(*) from forms where id = ${ghostForm.id}`),
            container.oneFirst(sql`select count(*) from form_defs where "formId" = ${ghostForm.id}`),
            container.oneFirst(sql`select count(*) from form_attachments where "formId" = ${ghostForm.id}`),
            container.oneFirst(sql`select count(*) from blobs`)
          ]))
          .then((counts) => counts.should.eql([ 0, 0, 0, 0 ]))))));

  it('should purge the form fields of a form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms/simple/draft')
        .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="2"'))
        .set('Content-Type', 'application/xml')
        .expect(200)
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft/publish')
          .expect(200))
        .then(() => asAlice.post('/v1/projects/1/forms/simple/draft')
          .send(testData.forms.simple.replace('id="simple"', 'id="simple" version="3"'))
          .set('Content-Type', 'application/xml')
          .expect(200))
        .then(() => asAlice.delete('/v1/projects/1/forms/simple')
          .expect(200))
        .then(() => container.Forms.purge(true)) // force all deleted forms to be purged
        .then(() => Promise.all([
          container.oneFirst(sql`select count(*) from form_fields where "formId" = 1`)
        ]))
        .then((counts) => counts.should.eql([ 0 ])))));

  it('should purge the select multiple values of a purged form', testService((service, container) =>
    service.login('alice', (asAlice) =>
      asAlice.post('/v1/projects/1/forms?publish=true')
        .send(testData.forms.selectMultiple)
        .set('Content-Type', 'application/xml')
        .then(() => asAlice.post('/v1/projects/1/forms/selectMultiple/submissions')
          .set('Content-Type', 'application/xml')
          .send(testData.instances.selectMultiple.one))
        .then(() => exhaust(container))
        .then(() => asAlice.delete('/v1/projects/1/forms/selectMultiple'))
        .then(() => container.Forms.purge(true))
        .then(() => container.oneFirst(sql`select count(*) from form_field_values`))
        .then((count) => count.should.eql(0)))));

  describe('purging form submissions', () => {
    const withSimpleIds = (deprecatedId, instanceId) => testData.instances.simple.one
      .replace('one</instance', `${instanceId}</instanceID><deprecatedID>${deprecatedId}</deprecated`);

    it('should delete all defs of a submission', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.put('/v1/projects/1/forms/simple/submissions/one')
            .send(withSimpleIds('one', 'two'))
            .set('Content-Type', 'text/xml')
            .expect(200))
          .then(() => container.oneFirst(sql`select count(*) from submission_defs`)
            .then((count) => { count.should.equal(2); }))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple'))
          .then(() => container.Forms.purge(true))
          .then(() => container.oneFirst(sql`select count(*) from submission_defs`)
            .then((count) => { count.should.equal(0); })))));

    it('should purge attachments and blobs associated with the submission', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.binaryType)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('xml_submission_file', Buffer.from(testData.instances.binaryType.both), { filename: 'data.xml' })
            .attach('here_is_file2.jpg', Buffer.from('this is test file two'), { filename: 'here_is_file2.jpg' })
            .attach('my_file1.mp4', Buffer.from('this is test file one'), { filename: 'my_file1.mp4' })
            .expect(201))
          .then(() => asAlice.get('/v1/projects/1/forms/binaryType/submissions/both/attachments')
            .expect(200)
            .then(({ body }) => {
              body.should.eql([
                { name: 'here_is_file2.jpg', exists: true },
                { name: 'my_file1.mp4', exists: true }
              ]);
            }))
          .then(() => asAlice.delete('/v1/projects/1/forms/binaryType'))
          .then(() => container.Forms.purge(true))
          .then(() => container.oneFirst(sql`select count(*) from submission_attachments`)
            .then((count) => count.should.equal(0)))
          .then(() => container.oneFirst(sql`select count(*) from blobs`)
            .then((count) => count.should.equal(0))))));

    it('should purge submission comments from comments table', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/forms/simple/submissions/one/comments')
            .send({ body: 'new comment here' })
            .expect(200))
          .then(() => container.oneFirst(sql`select count(*) from comments`)
            .then((count) => count.should.equal(1)))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple'))
          .then(() => container.Forms.purge(true))
          .then(() => container.oneFirst(sql`select count(*) from comments`)
            .then((count) => count.should.equal(0))))));

    it('should purge submission comments from notes fields of audits table', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms/simple/submissions')
          .send(testData.instances.simple.one)
          .set('Content-Type', 'application/xml')
          .expect(200)
          .then(() => asAlice.patch('/v1/projects/1/forms/simple/submissions/one')
            .send({ reviewState: 'approved' })
            .set('X-Action-Notes', 'secret note')
            .expect(200))
          .then(() => container.Audits.getLatestByAction('submission.update')
            .then((audit) => { audit.get().notes.should.equal('secret note'); }))
          .then(() => asAlice.delete('/v1/projects/1/forms/simple'))
          .then(() => container.Forms.purge(true))
          .then(() => container.Audits.getLatestByAction('submission.update')
            // eslint-disable-next-line space-in-parens
            .then((audit) => audit.get().notes.should.equal('') )))));

    it('should purge client audit log attachments', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .set('Content-Type', 'application/xml')
          .send(testData.forms.clientAudits)
          .expect(200)
          .then(() => asAlice.post('/v1/projects/1/submission')
            .set('X-OpenRosa-Version', '1.0')
            .attach('audit.csv', createReadStream(appPath + '/test/data/audit.csv'), { filename: 'audit.csv' })
            .attach('xml_submission_file', Buffer.from(testData.instances.clientAudits.one), { filename: 'data.xml' })
            .expect(201))
          .then(() => asAlice.delete('/v1/projects/1/forms/audits'))
          .then(() => container.Forms.purge(true))
          .then(() => Promise.all([
            container.oneFirst(sql`select count(*) from client_audits`),
            container.oneFirst(sql`select count(*) from blobs`)
          ]))
          .then((count) => count.should.eql([ 0, 0 ])))));

    it('should purge xls blob of a form', testService((service, container) =>
      service.login('alice', (asAlice) =>
        asAlice.post('/v1/projects/1/forms?publish=true')
          .send(readFileSync(appPath + '/test/data/simple.xlsx'))
          .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .then(() => asAlice.delete('/v1/projects/1/forms/simple2') // Delete form
            .expect(200))
          .then(() => container.Forms.purge(true))
          .then(() => container.oneFirst(sql`select count(*) from blobs`))
          .then((count) => count.should.equal(0)))));
  });
});
