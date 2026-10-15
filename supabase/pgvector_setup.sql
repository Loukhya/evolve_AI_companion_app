-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create a table specifically designed to store memories and contexts along with their vector embeddings
create table if not exists memory_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  content_type text check (content_type in ('journal', 'mood', 'chat', 'insight', 'interest')),
  content text not null,
  embedding vector(384), -- Using 384 dimensions matching models like all-MiniLM-L6-v2
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table memory_nodes enable row level security;

-- Policy: Users can only see their own memory nodes
create policy "Users can view their own memory nodes." 
  on memory_nodes for select 
  using ( auth.uid() = user_id );

-- Policy: Users can only insert their own memory nodes
create policy "Users can insert their own memory nodes." 
  on memory_nodes for insert 
  with check ( auth.uid() = user_id );

-- Create a function to perform semantic search using cosine similarity
create or replace function match_memories (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  id uuid,
  content text,
  content_type text,
  similarity float,
  created_at timestamp with time zone
)
language plpgsql
stable
as $$
declare
  -- You can use an inner limit to bound the query initially (optional but good for bigger tables)
begin
  return query
  select
    mn.id,
    mn.content,
    mn.content_type,
    1 - (mn.embedding <=> query_embedding) as similarity,
    mn.created_at
  from memory_nodes mn
  where mn.user_id = p_user_id
  -- Use cosine distance operator to filter by threshold
  and 1 - (mn.embedding <=> query_embedding) > match_threshold
  order by mn.embedding <=> query_embedding
  limit match_count;
end;
$$;
