// cpp code for optimsed rendering and calc of trees
#include <emscripten.h>
#include <cstdint>
#include <vector>
#include <queue>
#include <unordered_map>
#include <algorithm>

static constexpr int MAX_NODES = 512;

struct Node {
  int id        = -1;
  int parent    = -1;
  float x       = 0.0f;
  float y       = 0.0f;
  std::vector<int> children;   // child ids
};

static std::unordered_map<int, Node> nodes;
static std::vector<int> roots;            
static std::vector<int> subtreeBuf;

static int countLeaves(int id) {
  auto &n = nodes[id];
  if (n.children.empty()) return 1;
  int sum = 0;
  for (int c : n.children) sum += countLeaves(c);
  return sum;
}

static float layoutSubtree(int id, float startX, float depth,
                           float padX, float padY) {
  auto &n = nodes[id];
  n.y = depth * padY;

  if (n.children.empty()) {
    n.x = startX;
    return startX + padX;     // next available x
  }

  float cursor = startX;
  float firstChildCenter = 0.0f;
  float lastChildCenter  = 0.0f;

  for (size_t i = 0; i < n.children.size(); ++i) {
    float before = cursor;
    cursor = layoutSubtree(n.children[i], cursor, depth + 1, padX, padY);
    float childCenter = (before + cursor - padX) * 0.5f;
    if (i == 0)                          firstChildCenter = childCenter;
    if (i == n.children.size() - 1)      lastChildCenter  = childCenter;
  }

  n.x = (firstChildCenter + lastChildCenter) * 0.5f;
  return cursor;
}


extern "C" {

EMSCRIPTEN_KEEPALIVE
void reset() {
  nodes.clear();
  roots.clear();
  subtreeBuf.clear();
}

EMSCRIPTEN_KEEPALIVE
void addNode(int id) {
  if (nodes.count(id)) return;
  Node n;
  n.id = id;
  nodes[id] = n;
}

EMSCRIPTEN_KEEPALIVE
void addEdge(int parentId, int childId) {
  if (!nodes.count(parentId) || !nodes.count(childId)) return;
  nodes[childId].parent = parentId;
  nodes[parentId].children.push_back(childId);
}

EMSCRIPTEN_KEEPALIVE
void computeLayout(float padX, float padY, float baseX, float baseY) {
  roots.clear();
  for (auto &[id, n] : nodes) {
    if (n.parent == -1) roots.push_back(id);
  }
  std::sort(roots.begin(), roots.end());

  float cursor = baseX;
  for (int r : roots) {
    cursor = layoutSubtree(r, cursor, 0, padX, padY);
    cursor += padX;
  }

  if (baseY != 0.0f) {
    for (auto &[id, n] : nodes) {
      n.y += baseY;
    }
  }
}

EMSCRIPTEN_KEEPALIVE
float getNodeX(int id) {
  auto it = nodes.find(id);
  return it != nodes.end() ? it->second.x : -1.0f;
}

EMSCRIPTEN_KEEPALIVE
float getNodeY(int id) {
  auto it = nodes.find(id);
  return it != nodes.end() ? it->second.y : -1.0f;
}

EMSCRIPTEN_KEEPALIVE
void getSubtree(int rootId) {
  subtreeBuf.clear();
  if (!nodes.count(rootId)) return;

//bfs
  std::queue<int> q;
  q.push(rootId);
  while (!q.empty()) {
    int cur = q.front(); q.pop();
    subtreeBuf.push_back(cur);
    for (int c : nodes[cur].children) q.push(c);
  }
}

EMSCRIPTEN_KEEPALIVE
int getSubtreeCount() {
  return static_cast<int>(subtreeBuf.size());
}

EMSCRIPTEN_KEEPALIVE
int getSubtreeId(int index) {
  if (index < 0 || index >= (int)subtreeBuf.size()) return -1;
  return subtreeBuf[index];
}

EMSCRIPTEN_KEEPALIVE
int getNodeCount() {
  return static_cast<int>(nodes.size());
}

EMSCRIPTEN_KEEPALIVE
int getRootCount() {
  return static_cast<int>(roots.size());
}

EMSCRIPTEN_KEEPALIVE
int getRootId(int index) {
  if (index < 0 || index >= (int)roots.size()) return -1;
  return roots[index];
}
} 