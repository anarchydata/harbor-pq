section Section1;

shared Query1 = let
    Source = Excel.CurrentWorkbook(){[Name="Query1"]}[Content],
    #"Changed Type" = Table.TransformColumnTypes(Source,{{"Date", type datetime}, {"Customer", type text}, {"Region", type text}, {"SalesAmount", Int64.Type}})
in
    #"Changed Type";
