#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <algorithm>
#include <cctype>
#include <fstream>
#include <string>
#include "core/Conventions.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "services/Catalog.hpp"

namespace {

nlohmann::json builtinCatalog() {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  return pg::catalogJson(reg);
}

const nlohmann::json& moduleById(const nlohmann::json& catalog, const std::string& id) {
  for (const auto& m : catalog["modules"])
    if (m["id"] == id) return m;
  FAIL("no module " + id + " in the catalog");
  return catalog;   // unreachable; FAIL throws
}

const nlohmann::json* findByField(const nlohmann::json& array, const char* field, const std::string& value) {
  for (const auto& entry : array)
    if (entry[field] == value) return &entry;
  return nullptr;
}

}  // namespace

TEST_CASE("the catalog lists every registered module, sorted, with its conventions", "[catalog]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const nlohmann::json catalog = pg::catalogJson(reg);

  REQUIRE(catalog["modules"].size() == reg.all().size());
  for (const pg::RegisteredModule* m : reg.all()) REQUIRE(findByField(catalog["modules"], "id", m->desc->id) != nullptr);
  REQUIRE(std::is_sorted(catalog["modules"].begin(), catalog["modules"].end(),
                         [](const nlohmann::json& a, const nlohmann::json& b) {
                           return a["id"].get<std::string>() < b["id"].get<std::string>();
                         }));

  REQUIRE(catalog["conventions"]["octavesPerUnit"] == 10.0);
  REQUIRE(catalog["conventions"]["middleCHz"].get<double>() == Catch::Approx(261.6256));
  REQUIRE(catalog["conventions"]["blockSize"] == pg::kMaxBlockSize);
  REQUIRE(catalog["conventions"]["lanes"].size() == 4);
  REQUIRE(catalog["conventions"]["lanes"][0] == "v0.L");
}

TEST_CASE("the catalog describes a module the UI has never heard of", "[catalog]") {
  const nlohmann::json catalog = builtinCatalog();
  const nlohmann::json& filter = moduleById(catalog, "filter.multi");
  REQUIRE(filter["category"] == "Filters");
  REQUIRE(filter["doc"].get<std::string>().size() > 10);
  REQUIRE(filter["flags"]["terminal"] == false);

  // A modulatable param carries an implicit input port, and the port says which param it feeds so the UI can
  // draw it on the knob rather than in the port list.
  const nlohmann::json* declared = findByField(filter["inputs"], "id", "in");
  REQUIRE(declared != nullptr);
  REQUIRE((*declared)["implicit"] == false);
  REQUIRE((*declared)["kind"] == "continuous");
  REQUIRE(declared->contains("param") == false);

  const nlohmann::json* implicit = findByField(filter["inputs"], "id", "param:cutoff");
  REQUIRE(implicit != nullptr);
  REQUIRE((*implicit)["implicit"] == true);
  REQUIRE((*implicit)["param"] == "cutoff");

  const nlohmann::json* cutoff = findByField(filter["params"], "id", "cutoff");
  REQUIRE(cutoff != nullptr);
  REQUIRE((*cutoff)["min"] == Catch::Approx(8.f));
  REQUIRE((*cutoff)["max"] == Catch::Approx(136.f));
  REQUIRE((*cutoff)["default"] == Catch::Approx(60.f));
  REQUIRE((*cutoff)["unit"] == "semitones");
  REQUIRE((*cutoff)["curve"] == "linear");
  REQUIRE((*cutoff)["flags"]["modulatable"] == true);
  REQUIRE((*cutoff)["flags"]["structural"] == false);
  REQUIRE(cutoff->contains("enumLabels") == false);

  // An enum param carries its labels; a structural one is marked so the UI knows the change rebuilds a node.
  const nlohmann::json* model = findByField(filter["params"], "id", "model");
  REQUIRE(model != nullptr);
  REQUIRE((*model)["flags"]["enum"] == true);
  REQUIRE((*model)["enumLabels"].size() == 8);
  REQUIRE((*model)["enumLabels"][3] == "Digital");
  REQUIRE((*model)["uiWidget"] == "select");

  const nlohmann::json* table = findByField(moduleById(catalog, "osc.wavetable")["params"], "id", "table");
  REQUIRE(table != nullptr);
  REQUIRE((*table)["flags"]["structural"] == true);
  REQUIRE((*table)["flags"]["modulatable"] == false);

  const nlohmann::json& notes = moduleById(catalog, "note.toCv");
  const nlohmann::json* events = findByField(notes["inputs"], "id", "notes");
  REQUIRE(events != nullptr);
  REQUIRE((*events)["kind"] == "event");
  // The role, not the kind, is what tells the editor this event port carries notes rather than triggers.
  REQUIRE((*events)["role"] == "note");
  REQUIRE(findByField(moduleById(catalog, "osc.wavetable")["inputs"], "id", "pitch")->at("role") == "pitch");
  REQUIRE(findByField(moduleById(catalog, "phase.clock")["outputs"], "id", "phase")->at("role") == "phase");
  REQUIRE(moduleById(catalog, "io.audioOut")["flags"]["terminal"] == true);
  REQUIRE(moduleById(catalog, "phase.clock")["flags"]["needsTransport"] == true);
}

TEST_CASE("the catalog hash is stable and content addressed", "[catalog]") {
  const std::string hash = builtinCatalog()["catalogHash"];
  REQUIRE(hash.size() == 16);
  for (const char c : hash) REQUIRE(std::isxdigit(static_cast<unsigned char>(c)));
  REQUIRE(builtinCatalog()["catalogHash"] == hash);   // same registry, same hash

  // A different module set has to hash differently, or a stale UI cache would survive a module being added.
  pg::Registry more;
  pg::registerBuiltinModules(more);
  pg::test::registerTestModules(more);
  REQUIRE(pg::catalogJson(more)["catalogHash"] != hash);
}

TEST_CASE("the catalog carries no vendored library name into the user interface", "[catalog]") {
  // `--catalog` is the one place the vendored DSP's own parameter table reaches a string the UI displays.
  // The repository-wide guard (scripts/check-trademark.mjs) reads sources, not generated documents, so the
  // generated document is checked here instead.
  std::string dump = builtinCatalog().dump();
  std::transform(dump.begin(), dump.end(), dump.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  REQUIRE(dump.find("vital") == std::string::npos);
  REQUIRE(dump.find("tytel") == std::string::npos);
}

TEST_CASE("the catalog groups the effects by what they work on", "[catalog]") {
  const nlohmann::json catalog = builtinCatalog();
  REQUIRE(moduleById(catalog, "fx.reverb")["category"] == "Audio FX");
  for (const char* id : {"notefx.chord", "notefx.quantize", "notefx.arp", "notefx.humanize"}) {
    const nlohmann::json& m = moduleById(catalog, id);
    INFO(id);
    REQUIRE(m["category"] == "Note FX");
    const nlohmann::json* in = findByField(m["inputs"], "id", "notes");
    const nlohmann::json* out = findByField(m["outputs"], "id", "notes");
    REQUIRE(in != nullptr);
    REQUIRE(out != nullptr);
    REQUIRE((*in)["role"] == "note");
    REQUIRE((*out)["role"] == "note");
  }
}

TEST_CASE("the piano publishes keys and declares a keyboard on its face", "[catalog]") {
  const nlohmann::json catalog = builtinCatalog();
  const nlohmann::json& piano = moduleById(catalog, "display.piano");
  REQUIRE(piano["category"] == "Display");
  REQUIRE(piano["flags"]["publishesKeys"] == true);
  REQUIRE(piano["flags"]["writesTelemetry"] == true);
  REQUIRE(moduleById(catalog, "display.meter")["flags"]["publishesKeys"] == false);
  REQUIRE(piano["face"].size() == 2);
  REQUIRE(piano["face"][0][1] == "piano");
  REQUIRE(piano["face"][0][0] == "pitch");
  REQUIRE(piano["face"][1][0] == "gate");
}

TEST_CASE("golden/catalog.json is what --catalog prints today", "[catalog]") {
  // The committed document is what shared/protocol/catalog.test.ts parses, so it has to keep up with the
  // engine. Regenerate it with:  ./build/engine/phasegrid-engine --catalog > engine/tests/golden/catalog.json
  std::ifstream in(std::string(PG_TEST_DIR) + "/golden/catalog.json");
  REQUIRE(in.good());
  const nlohmann::json golden = nlohmann::json::parse(in, nullptr, false);
  REQUIRE_FALSE(golden.is_discarded());
  REQUIRE(golden["catalogHash"] == builtinCatalog()["catalogHash"]);
  REQUIRE(golden == builtinCatalog());
}

TEST_CASE("the catalog publishes a module's face, and null for a module without one", "[catalog]") {
  const nlohmann::json catalog = builtinCatalog();
  const nlohmann::json& sine = moduleById(catalog, "osc.sine");
  REQUIRE(sine["face"].is_array());
  REQUIRE(sine["face"].size() == 3);
  REQUIRE(sine["face"][0] == nlohmann::json({"reset", "wave", "wave", "wave", "fold", "fold", "out"}));
  // Padded: every row is as long as the longest.
  for (const auto& row : sine["face"]) REQUIRE(row.size() == 7);
  REQUIRE(moduleById(catalog, "filter.multi")["face"].is_null());
}
