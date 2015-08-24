(function() {
    var Ext = window.Ext4 || window.Ext;

    Ext.define('Rally.apps.defectsummarymatrix.DefectSummaryMatrixApp', {
        extend: 'Rally.app.TimeboxScopedApp',
        componentCls: 'app',
        appName: 'Defect Summary Matrix',
        scopeType: 'release',

        comboboxConfig: {
            fieldLabel: 'Release ',
            labelAlign: 'right',
            labelWidth: 30,
            labelPad: 15,
            growToLongestValue: true,
            margin: '10px 0',
            minWidth: 230,
            padding: '0 0 0 5px'
        },

        clientMetrics: [
            {
                method: '_onMatrixCellClicked',
                description: 'matrix cell clicked'
            }
        ],

        initComponent: function() {
            this.callParent(arguments);
            this.mon(this, 'afterrender', function() {
                this.setLoading(true);
            }, this );

            Rally.data.ModelFactory.getModel({
                type:'Defect',
                success: this._onDefectModelRetrieved,
                scope: this
            });
        },

        _addContent: function(scope) {
            this._hideComponentIfNeeded(this.defectGridHeader);
            this._hideComponentIfNeeded(this.defectGrid);

            this.releaseFilter = this.context.getTimeboxScope().getQueryFilter();
            if (this.allDefectStore) {
                this.allDefectStore.clearFilter(true);
                this.allDefectStore.filter(this.releaseFilter);
            } else {
                this._initializeAllDefectStore();
            }
        },

        onScopeChange: function(scope) {
            if (this.matrixGrid) {
                this.matrixGrid.setLoading(true);
            }
            this._addContent(scope);
        },

        onNoAvailableTimeboxes: function() {
            this.setLoading(false);
        },

        _onDefectModelRetrieved: function(model) {
            this.defectModel = model;

            this._extractAllowedValues(model, ['Priority', 'Owner']).then({
                success: function(allowedValues) {
                    this.priorities = allowedValues.Priority;
                    console.log(allowedValues.Owner);
                    this.owners = [];
                    for (var i = 0; i < allowedValues.Owner.length; i++) {
                        if (allowedValues.Owner[i] === 'builduser(reserved)') {
                            continue;
                        }
                        this.owners.push(allowedValues.Owner[i]);
                    }
                    console.log(this.owners);
                    this._initializeAllDefectStore();
                },
                scope: this
            });
        },

        _extractAllowedValues: function(defectModel, fieldNames) {
            var result = {};
            var deferred = Ext.create('Deft.Deferred');

            _.each(fieldNames, function(fieldName) {
                defectModel.getField(fieldName).getAllowedValueStore().load({
                    callback: function(records, operation, success) {
                        var allowedValues = _.map(records, function(record) {
                            var value = record.get('StringValue');
                            return value === '' ? 'None' : value;
                        });

                        result[fieldName] = allowedValues;

                        if(_.keys(result).length === fieldNames.length) {
                            deferred.resolve(result);
                        }
                    }
                });
            });

            return deferred.promise;
        },

        _hideComponentIfNeeded: function(component) {
            if (component) {
                component.hide();
            }
        },

        _showComponentIfNeeded: function(component) {
            if (component && component.isHidden()) {
                component.show();
            }
        },

        _initializeAllDefectStore: function() {
            if (this.releaseFilter && this.defectModel) {
                this.allDefectStore = Ext.create('Rally.data.wsapi.Store', {
                    model: this.defectModel,
                    fetch: ['Priority','Owner'],
                    autoLoad: true,
                    limit: Infinity,
                    context: this.getContext().getDataContext(),
                    filters: this.releaseFilter,
                    listeners: {
                        load: this._onAllDefectStoreLoaded,
                        scope: this
                    }
                });
            }
        },

        _onAllDefectStoreLoaded: function(store, records, successful, eOpts) {
            this._initializeMatrixTable();
            this._populateMatrixTable(records);
            this._createOwnerRecords(records);
            this._updateMatrixGrid();
            this.setLoading(false);
        },

        _initializeMatrixTable: function() {
            this.matrixTable = [];
            Ext.each(this.owners, function(owner, oIndex) {
                this.matrixTable[oIndex] = [];
                Ext.each(this.priorities, function(priority, pIndex) {
                    this.matrixTable[oIndex][pIndex] = 0;
                }, this);
            }, this);
        },

        _populateMatrixTable: function(defectRecords) {
            var ownerIndex, priorityIndex;
            Ext.each(defectRecords, function(record) {
                console.log(record.get('Owner'));
                ownerIndex = this._determineOwnerIndex(record.get('Owner')._refObjectName);
                priorityIndex = this._determinePriorityIndex(record.get('Priority'));
                this.matrixTable[ownerIndex][priorityIndex]++;
            }, this);
        },

        _determineOwnerIndex: function(value) {
            return this.owners.indexOf(value);
        },

        _determinePriorityIndex: function(value) {
            return this.priorities.indexOf(value);
        },

        _createOwnerRecords: function(defectRecords) {
            var currentRecord,
                rowTotal,
                colTotals = new Array(this.priorities);
            this.ownerRecords = [];

            Ext.each(this.priorities, function(priority, pIndex) {
                colTotals[pIndex] = 0;
            });

            Ext.each(this.matrixTable, function(priorityArray, ownerIndex){
                currentRecord = {Owner: this.owners[ownerIndex]};
                rowTotal = 0;
                Ext.each(priorityArray, function(numDefects, priorityIndex) {
                    currentRecord[this.priorities[priorityIndex]] = this._createDetailLink(numDefects);
                    rowTotal += numDefects;
                    colTotals[priorityIndex] += numDefects;
                }, this);
                currentRecord.RowTotal = this._createDetailLink(rowTotal);
                this.ownerRecords.push(currentRecord);
            }, this);

            currentRecord = {Owner: 'Total'};
            Ext.each(this.priorities, function(priority, pIndex) {
                currentRecord[priority] = this._createDetailLink(colTotals[pIndex]);
            }, this);
            currentRecord.RowTotal = this._createDetailLink(defectRecords.length);

            this.ownerRecords.push(currentRecord);
        },

        _updateMatrixGrid: function() {
            var newMatrixGridStore = this._createMatrixGridStore();

            if (this.matrixGrid) {
                this.matrixGrid.getView().bindStore(newMatrixGridStore);
                this.matrixGrid.setLoading(false);
            } else {
                this._createMatrixGrid(newMatrixGridStore);
            }
        },

        _createMatrixGridStore: function() {
            return Ext.create('Rally.data.custom.Store', {
                data: this.ownerRecords,
                pageSize: this.ownerRecords.length
            });
        },

        _createMatrixGrid: function(store) {
            this.matrixGrid = this.add(Ext.create('Rally.ui.grid.Grid', {
                store: store,
                showPagingToolbar: false,
                sortableColumns: false,
                showRowActionsColumn: false,
                columnCfgs: this._buildColumns(),
                listeners: {
                    cellclick: this._onMatrixCellClicked,
                    scope: this
                }
            }));
        },

        _buildColumns: function() {
            var columns = [
                {
                  text: "",
                  dataIndex: 'Owner',
                  flex: 0.4
                }
            ];

            Ext.each(this.priorities, function(priority) {
                columns.push({
                    text: priority,
                    dataIndex: priority,
                    flex: 0.3
                });
            });


            columns.push({
                text: "Total",
                dataIndex: 'RowTotal',
                flex: 0.3
            });

            return columns;
        },

        _createDetailLink: function(count) {
            return "<a href='#' onclick='return false;'>" + count + "</a>";
        },

        _onMatrixCellClicked: function(table, td, cellIndex, record, tr, rowIndex, e, eOpts) {
            cellIndex--;
            if (cellIndex >= 0) {
                this._updateDefectGrid(rowIndex, cellIndex);
            }
        },

        _updateDefectGrid: function(ownerIndex, priorityIndex) {
            var owner = this.owners[ownerIndex],
                priority = this.priorities[priorityIndex],
                allOwners = (typeof owner === "undefined"),
                allPriorities = (typeof priority === "undefined"),
                newTitle = this._determineDefectGridTitle(owner, priority, allOwners, allPriorities),
                newFilters = this._createNewDefectFilters(owner, priority, allOwners, allPriorities);

            if (this.defectGrid) {
                this._changeDefectGridTitleAndFilters(newTitle, newFilters);
            } else {
                this._createDefectGrid(newTitle, newFilters);
            }
        },

        _createDefectGrid: function(title, filters) {
            this.defectGridHeader = this.add({
                xtype: 'component',
                itemId: 'defectGridHeader',
                html: title,
                style: {
                    padding: '20px 0 6px 0',
                    width: '100%',
                    textAlign: 'center',
                    fontWeight: 'bold'
                }
            });
            this.defectGrid = this.add({
                xtype: 'rallygrid',
                itemId: 'defectGrid',
                model: this.defectModel,
                storeConfig: {
                    filters: filters
                },
                autoLoad: false,
                columnCfgs:['FormattedID', 'Name', 'State', 'Priority', 'Owner'],
                limit: Infinity,
                enableEditing: false,
                margin: '0 0 10px 0'
            });
        },

        _changeDefectGridTitleAndFilters: function(newTitle, newFilters) {
            this.defectGridHeader.update(newTitle);
            this.defectGrid.getStore().clearFilter(true);
            this.defectGrid.getStore().filter(newFilters);

            this._showComponentIfNeeded(this.defectGridHeader);
            this._showComponentIfNeeded(this.defectGrid);
        },

        _createNewDefectFilters: function(owner, priority, allOwners, allPriorities) {
            var newFilters = [this.releaseFilter];

            if (!allOwners) {
                newFilters.push({
                    property: 'Owner.DisplayName',
                    value: owner
                });
            }
            if (!allPriorities) {
                newFilters.push({
                    property: 'Priority',
                    value: priority
                });
            }

            return newFilters;
        },

        _determineDefectGridTitle: function(owner, priority, allOwners, allPriorities) {
            if (!allPriorities && !allOwners) {
                if (owner === 'None') {
                    return priority + ' Defects Without an Owner';
                } else {
                    return priority + ' ' + owner + ' Defects';
                }
            } else if (allPriorities && allOwners) {
                return 'All Defects';
            } else if (allOwners) {
                return 'All ' + priority + ' Defects';
            } else if (allPriorities) {
                if (owner === 'None') {
                    return 'All Defects Without an Owner';
                } else {
                    return 'All ' + owner + ' Defects';
                }
            }

            return '';
        }
    });
})();
