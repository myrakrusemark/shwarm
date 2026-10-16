-- Decided Oct 15, "A plain word typed in search also finds tags": the search index holds each node's tags beside its
-- title, pitch and done test, so "drawing" finds a shwarm tagged #drawing (prefix matching as before: "draw" does too).
--
-- node_fts was an external-content index over node (title, what, done_when); node has no tags column, so it can't
-- stay one. It becomes a plain FTS5 table holding its own copy of those words plus `tags` (the node's tags, space
-- separated, in the author's order). Triggers keep it in step: on node (insert, delete, a change to the three words)
-- and on node_tag (insert, delete, update), so a new node's tags, added after its row in the same batch
-- (core/nodes.ts createNode), and a restore from backup (jobs/backup.ts, which leaves node_fts out and fills node and
-- node_tag again) both land in the index. Readers are unchanged: `SELECT rowid FROM node_fts WHERE node_fts MATCH ?`
-- (read/feed.ts), the rowid still the node's id.

DROP TRIGGER IF EXISTS node_fts_ai;
DROP TRIGGER IF EXISTS node_fts_ad;
DROP TRIGGER IF EXISTS node_fts_au;
DROP TABLE IF EXISTS node_fts;

CREATE VIRTUAL TABLE node_fts USING fts5 (title, what, done_when, tags);

CREATE TRIGGER node_fts_ai AFTER INSERT ON node BEGIN
  INSERT INTO node_fts (rowid, title, what, done_when, tags)
  VALUES (new.id, new.title, new.what, new.done_when,
          COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag WHERE node_id = new.id ORDER BY rowid)), ''));
END;
CREATE TRIGGER node_fts_ad AFTER DELETE ON node BEGIN
  DELETE FROM node_fts WHERE rowid = old.id;
END;
CREATE TRIGGER node_fts_au AFTER UPDATE OF title, what, done_when ON node BEGIN
  UPDATE node_fts SET title = new.title, what = new.what, done_when = new.done_when WHERE rowid = new.id;
END;

CREATE TRIGGER node_fts_tag_ai AFTER INSERT ON node_tag BEGIN
  UPDATE node_fts SET tags = COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag WHERE node_id = new.node_id ORDER BY rowid)), '')
  WHERE rowid = new.node_id;
END;
CREATE TRIGGER node_fts_tag_ad AFTER DELETE ON node_tag BEGIN
  UPDATE node_fts SET tags = COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag WHERE node_id = old.node_id ORDER BY rowid)), '')
  WHERE rowid = old.node_id;
END;
CREATE TRIGGER node_fts_tag_au AFTER UPDATE ON node_tag BEGIN
  UPDATE node_fts SET tags = COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag WHERE node_id = old.node_id ORDER BY rowid)), '')
  WHERE rowid = old.node_id;
  UPDATE node_fts SET tags = COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag WHERE node_id = new.node_id ORDER BY rowid)), '')
  WHERE rowid = new.node_id;
END;

-- Every node there is, with its tags.
INSERT INTO node_fts (rowid, title, what, done_when, tags)
SELECT n.id, n.title, n.what, n.done_when,
       COALESCE((SELECT group_concat(tag, ' ') FROM (SELECT tag FROM node_tag t WHERE t.node_id = n.id ORDER BY t.rowid)), '')
FROM node n;
