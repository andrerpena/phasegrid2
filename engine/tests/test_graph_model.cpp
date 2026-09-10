#include <catch2/catch_test_macros.hpp>
#include "core/GraphModel.hpp"
#include "modules/TestModules.hpp"

static pg::Registry& reg() { static pg::Registry r; static bool init = (pg::test::registerTestModules(r), true); (void)init; return r; }

TEST_CASE("GraphModel validates nodes, edges and params", "[model]") {
  pg::GraphModel m;
  REQUIRE(m.addNode(reg(), {"c", "test.const", {{"value", 0.5f}}}));
  REQUIRE(m.addNode(reg(), {"g", "test.gain", {}}));
  REQUIRE(m.addNode(reg(), {"c", "test.const", {}}).code == "E_DUP_ID");
  REQUIRE(m.addNode(reg(), {"x", "nope.type", {}}).code == "E_UNKNOWN_TYPE");
  REQUIRE(m.addNode(reg(), {"y", "test.const", {{"bogus", 1.f}}}).code == "E_PARAM_NOT_FOUND");

  REQUIRE(m.addEdge(reg(), {"e1", "c", "out", "g", "in"}));
  REQUIRE(m.addEdge(reg(), {"e1", "c", "out", "g", "in"}).code == "E_DUP_ID");
  REQUIRE(m.addEdge(reg(), {"e2", "c", "out", "g", "in"}).code == "E_DUP_EDGE");
  REQUIRE(m.addEdge(reg(), {"e3", "c", "out", "g", "param:gain"}));
  REQUIRE(m.addEdge(reg(), {"e4", "c", "nope", "g", "in"}).code == "E_PORT_NOT_FOUND");
  REQUIRE(m.addEdge(reg(), {"e5", "zz", "out", "g", "in"}).code == "E_NODE_NOT_FOUND");

  REQUIRE(m.addNode(reg(), {"ev", "test.eventGen", {}}));
  REQUIRE(m.addEdge(reg(), {"e6", "ev", "events", "g", "in"}).code == "E_KIND_MISMATCH");

  REQUIRE(m.setParam(reg(), "g", "gain", 0.25f));
  REQUIRE(m.nodes().at("g").params.at("gain") == 0.25f);
  REQUIRE(m.setParam(reg(), "g", "nope", 1.f).code == "E_PARAM_NOT_FOUND");

  REQUIRE(m.removeEdge("e3"));
  REQUIRE(m.removeEdge("e3").code == "E_EDGE_NOT_FOUND");
  REQUIRE(m.removeNode("c"));
  REQUIRE(m.edges().count("e1") == 0);
  REQUIRE(m.removeNode("c").code == "E_NODE_NOT_FOUND");
}

TEST_CASE("GraphModel detects unknown types with empty registry", "[model]") {
  pg::GraphModel m;
  REQUIRE(m.addNode(reg(), {"c", "test.const", {{"value", 0.5f}}}));
  REQUIRE(m.addNode(reg(), {"g", "test.gain", {}}));

  pg::Registry emptyReg;
  REQUIRE(m.addEdge(emptyReg, {"e1", "c", "out", "g", "in"}).code == "E_UNKNOWN_TYPE");
  REQUIRE(m.setParam(emptyReg, "g", "gain", 0.25f).code == "E_UNKNOWN_TYPE");
}
