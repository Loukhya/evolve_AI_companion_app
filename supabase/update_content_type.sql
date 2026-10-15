ALTER TABLE memory_nodes DROP CONSTRAINT memory_nodes_content_type_check;
ALTER TABLE memory_nodes ADD CONSTRAINT memory_nodes_content_type_check CHECK (content_type IN ('journal', 'mood', 'chat', 'insight', 'interest'));
