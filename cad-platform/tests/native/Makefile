CXX ?= clang++

CORE := ../../core
BUILD := build
TARGET := $(BUILD)/cadweb_core_tests
SAVE_SYNC_TARGET := $(BUILD)/cadweb_save_sync_tests
REVISION_PLANNER_TARGET := $(BUILD)/cadweb_revision_planner_tests

CPPFLAGS := \
	-I$(CORE)/include \
	-I$(CORE)/src \
	-I$(CORE)/generated \
	-I$(CORE)/third_party/flatbuffers/include
CXXFLAGS ?= -O2
CXXFLAGS += -std=c++17 -Wall -Wextra -Wpedantic -Werror

SOURCES := \
	test_main.cpp \
	$(CORE)/src/CadDeltaWriter.cpp \
	$(CORE)/src/CadWebWriter.cpp \
	$(CORE)/src/detail/Sha256.cpp \
	$(CORE)/src/detail/ZipStore.cpp
SAVE_SYNC_SOURCES := \
	test_save_sync.cpp \
	$(CORE)/src/CadWebChangeTracker.cpp \
	$(CORE)/src/CadWebOutbox.cpp \
	$(CORE)/src/CadWebDurableStore.cpp \
	$(CORE)/src/detail/Sha256.cpp
REVISION_PLANNER_SOURCES := \
	test_revision_planner.cpp \
	$(CORE)/src/CadWebRevisionPlanner.cpp \
	$(CORE)/src/CadDeltaWriter.cpp \
	$(CORE)/src/CadWebWriter.cpp \
	$(CORE)/src/detail/Sha256.cpp \
	$(CORE)/src/detail/ZipStore.cpp
HEADERS := \
	$(CORE)/include/cadweb/CadDelta.h \
	$(CORE)/include/cadweb/CadDeltaWriter.h \
	$(CORE)/include/cadweb/CadDocument.h \
	$(CORE)/include/cadweb/CadWebChangeTracker.h \
	$(CORE)/include/cadweb/CadWebDurableStore.h \
	$(CORE)/include/cadweb/CadWebLimits.h \
	$(CORE)/include/cadweb/CadWebOutbox.h \
	$(CORE)/include/cadweb/CadWebRevisionPlanner.h \
	$(CORE)/include/cadweb/CadWebWriter.h \
	$(CORE)/generated/geometry_generated.h \
	$(CORE)/src/detail/ProducerLimits.h \
	$(CORE)/src/detail/Sha256.h \
	$(CORE)/src/detail/ZipStore.h \
	$(wildcard $(CORE)/third_party/flatbuffers/include/flatbuffers/*.h)

.PHONY: all test clean

all: $(TARGET) $(SAVE_SYNC_TARGET) $(REVISION_PLANNER_TARGET)

$(TARGET): $(SOURCES) $(HEADERS)
	mkdir -p $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(SOURCES) -o $(TARGET)

$(SAVE_SYNC_TARGET): $(SAVE_SYNC_SOURCES) $(HEADERS)
	mkdir -p $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(SAVE_SYNC_SOURCES) -o $(SAVE_SYNC_TARGET)

$(REVISION_PLANNER_TARGET): $(REVISION_PLANNER_SOURCES) $(HEADERS)
	mkdir -p $(BUILD)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $(REVISION_PLANNER_SOURCES) -o $(REVISION_PLANNER_TARGET)

test: $(TARGET) $(SAVE_SYNC_TARGET) $(REVISION_PLANNER_TARGET)
	./$(TARGET)
	./$(SAVE_SYNC_TARGET)
	./$(REVISION_PLANNER_TARGET)

clean:
	$(RM) -r $(BUILD)
